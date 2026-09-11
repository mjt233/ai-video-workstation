# 任务日志：分级、降噪、保留与清理

> 返回 [任务管理总览](../task-manager.md)

任务日志（`data/workflow.db` 的 `task_logs` 表）记录**工作流任务**（图片 / 视频 / TTS 生成）的执行过程。本文档说明日志的写入语义、降噪策略、保留期清理与占用统计口径。

> ffmpeg 任务与 LLM 会话**不写** `task_logs`（前者仅内存注册表 + 控制台 stderr，后者流式内容直接推 WS），因此本文的保留期与清理只作用于工作流任务。

## 一、日志从哪来

| 写入点 | 位置 | 内容 |
|--------|------|------|
| 任务创建 | `routes/workflow.ts`（`POST /workflow/run`）、`retry` | `Task created: {workflowId}/{impl}` |
| 引擎开始执行 | `workflow-engine.ts: runTask` 开头 | `Starting workflow: {name} (impl: {impl})` |
| 提交远端 | 同上 | `Submitting task to AI API (provider: …, instance: …)` → `Submitted, remote task ID: {id}` |
| **轮询** | 同上（2 秒一次） | 见下方「降噪规则」 |
| 产物处理 | 同上 | `Parsing output...` / `已有资产已归档为历史版本: …` / `Downloading|Fetching output from: …` / `Decoding base64 output body` / `Output written to: {path}` |
| 失败 | 同上 catch 分支 | `Task failed: {msg}`（`error` 级），完整堆栈只进控制台 |
| 中断 | `tasks/workflow-executor.ts` | `Task cancelled by user` |
| 重启重置 | `workflow-engine.ts: startEngine` | `Task reset from running to pending after server restart`（`warn` 级） |
| 特殊分支 | `workflow-engine.ts`（基础场景/上一分镜直接引用） | 复制资产说明与路径 |

## 二、日志分级语义

`level` 列取值与用途（前端「级别过滤」直接依赖这套语义）：

| 级别 | 含义 | 典型内容 |
|------|------|----------|
| `info` | 里程碑与**有效进度** | 创建、开始、提交、**进度变化**、产物落盘、完成 |
| `warn` | 不阻断的异常 | 重启后 running → pending 重置、TTS 降级跳过 |
| `error` | 任务失败 | `Task failed: {原因}`（远端失败时透出 provider 错误详情，如敏感内容拦截 / 余额不足） |
| `debug` | 低频心跳 | 状态长时间不变时的「轮询中（状态未变）」 |

前端过滤规则见 `composables/useTaskLogs.ts: filterLogsByLevel`：

- **全部**：原样展示（含 `debug` 心跳）；
- **信息**：隐藏 `debug`（即「信息及以上」）；
- **警告**：`warn` + `error`；
- **错误**：仅 `error`。

## 三、轮询降噪（为什么日志曾经爆炸）

### 改造前的问题（实测数据）

| 指标 | 数值 |
|------|------|
| `Poll result: status=.. progress=..` 行数 | 129,638（占全表 **89.2%**） |
| 其中与上一条完全相同 | 120,021（占轮询日志 **92.6%**） |
| 单任务日志最长 | 2,146 行（平均 87 行） |
| `task_logs` 表 + 索引占用 | 23.64 MB / 27.14 MB（**占库 87%**） |

根因：`workflow-engine.ts` 的 2 秒轮询循环里**无条件**写一条 debug 日志，而视频生成动辄十几分钟 → 单个任务上千行、其中绝大多数内容完全相同。

### 现在的规则（变化才记 + 心跳）

```ts
const signature = `${result.status}|${result.progress ?? '-'}`
if (signature !== lastStatus) {
  db.addLog(taskId, 'info', `进度更新：status=${result.status} progress=${result.progress}`)
  lastStatus = signature; lastLoggedAt = now
} else if (heartbeatMs > 0 && now - lastLoggedAt >= heartbeatMs) {
  db.addLog(taskId, 'debug', `轮询中（状态未变）：status=${result.status} progress=${result.progress}`)
  lastLoggedAt = now
}
// 其余情况不写日志
```

三条设计要点：

1. **进度变化提级为 `info`**：留下的都是有效信息，且「信息」过滤档就能看到完整进度轨迹（原来埋在 `debug` 里会被过滤掉）。
2. **心跳可配**：`taskLog.heartbeatSeconds`（默认 60 秒，`0` = 不写心跳）。心跳的价值是区分「任务卡死」与「任务在推进但状态没变」——日志时间戳停止推进就是卡死信号。
3. **终态里程碑必写**：循环退出后仍写 `Task completed with status: …` / `Parsing output...` / 产物路径 / 失败原因，因此**任何一个任务都必然有终态线索**，降噪不会让失败变成「无日志」。

效果：单个任务日志从「约每 2 秒 1 行」降到「每次进度变化 1 行 + 每 60 秒 1 行心跳」，实测降幅约一个数量级；因为进度由服务商推进（通常几十次变化），单任务日志稳定在几十行量级。

> 配置读取失败时回退 60 秒并打印日志（`resolvePollHeartbeatMs`），**不阻断生成任务**。

## 四、保留期与清理

### 配置（`server/config/system.json` 的 `taskLog` 子类）

```jsonc
{
  "taskLog": {
    "autoClean": {
      "enabled": true,
      "intervalHours": 24,   // 执行间隔（小时，1~720）
      "retentionDays": 14    // 日志保留期（天，1~3650）
    },
    "heartbeatSeconds": 60,  // 轮询心跳（秒，0~3600；0 = 不写）
    "lastRunAt": null        // 服务端维护，前端不可写
  }
}
```

可在 **系统设置 → 系统设置 → 日志** 中修改，**热生效**（调度器与引擎每轮重新读取，无需重启）。

### 安全边界（清理绝不越过）

| 约束 | 原因 |
|------|------|
| 只删 `task_logs`，**不删 `tasks` 行** | 任务管理器「历史」仍要能列出任务、终态与错误摘要 |
| 只删 `status IN ('completed','failed')` 任务的日志 | **`pending`/`running` 任务的日志永不删除**——运行中任务的排查线索最宝贵 |
| 不触碰产物文件与产物历史 | 日志清理与资产无关 |
| 截止时间比较用 `created_at < datetime(?, 'utc')` | `created_at` 是 SQLite `datetime('now')` 的 UTC 文本（无时区），与 JS ISO 串直接字符串比较会得到错误结果 |
| 分批删除（每批 `CLEANUP_BATCH_SIZE = 5000` 行，循环直到删空） | 缩短写锁持有时间，避免长事务阻塞引擎写入 |

### 手动入口

| 操作 | 入口 | 语义 |
|------|------|------|
| 立即清理超期日志 | 系统设置 → 日志 →「立即清理超期日志」/ `POST /api/system/task-log/clean` | **忽略开关**（`force`），沿用配置的保留期；二次确认弹窗展示可清理行数 |
| 清空历史日志 | 系统设置 → 日志 →「清空历史日志」/ `POST /api/system/task-log/purge` | 不看保留期，清空**全部已终态任务**日志；返回 `protectedRows` 说明有多少运行中日志被保护 |

两个入口都走 `confirm` 工具函数（删除建议 `error` 色），并在结果中回报删除行数与占用变化。

### 调度与磁盘回收

- `system/log-scheduler.ts`：每 1 小时检查一次是否到达 `intervalHours`；服务启动 60 秒后补跑一次（从未执行或已超期才跑）；进程内重入保护（`VACUUM` 会长时间持锁，绝不能并发）；日志前缀 `[tasklog-auto-clean]`，仅在「状态变化 / 真正触发 / 失败」时打印。
- 清理成功后执行 `wal_checkpoint(TRUNCATE)` + **`VACUUM`**，把空闲页归还并从文件尾部截断；`VACUUM` **必须在事务外**执行。
- **失败不更新 `lastRunAt`**：下一轮自动重试（避免「失败被当成执行过」而跳过一整天）。

### 占用统计口径（重要）

`db.getLogStats()` 返回多个口径，判断「清理是否腾出空间」必须用对指标：

| 字段 | 口径 | 用途 |
|------|------|------|
| `totalRows` | `task_logs` 行数 | 直观规模 |
| `tableBytes` / `indexBytes` | `dbstat` 实测（表 / 索引分别统计） | 定位「索引也在膨胀」的问题（索引曾占 7.26 MB） |
| `fileBytes` | 主库 + WAL + SHM 的 `stat` 大小 | 磁盘视角 |
| `allocatedBytes` | `page_count × page_size` | 文件高水位 |
| `freelistCount` / `freelistBytes` | 空闲页数量 / 字节 | **「删除过数据但还没回收」的信号**；`VACUUM` 后归零 |
| `cleanableRows` | 已终态且超期的行数 | 确认弹窗与清理预演 |
| `activeRows` | `pending`/`running` 任务的日志行数 | 展示「受保护」规模 |
| `oldestAt` | 最早一条日志时间 | 判断保留策略是否生效 |

> **不要用文件大小判断回收效果**：SQLite `VACUUM` 会把文件截断到实际数据量，但 Windows 等平台的文件系统可能保留磁盘分配，`stat` 大小不降反升都可能出现。**判据是 `freelistCount` 归零 + `allocatedBytes` 回落**。实测：删除 58,630 行后 `page_count` 3,201 → 879、`freelist` 0、文件 25.11 MB → 15.99 MB。

## 五、日志读取接口

`GET /api/workflow/tasks/:taskId/log`

| 参数 | 行为 |
|------|------|
| 不传 | 返回**全量**日志（向后兼容） |
| `limit=0` | 显式全量 |
| `limit=N` | 返回**最后 N 条**（`ORDER BY id DESC LIMIT N` 命中主键索引后正序返回） |

响应：`{ logs, total, limit, truncated }` —— `total` 为总行数，`truncated` 为真时表示 `logs` 只是尾部片段，前端据此提示「仅显示最后 N 条（共 M 条）」并提供「查看全部」。

**消费方与取值**：

| 消费方 | limit | 理由 |
|--------|-------|------|
| 画布节点轮询（`useCanvasGeneration.poll`） | `1` | 节点遮罩只展示最后一条；原实现每 2 秒拉全量（单任务可达 2,146 行），是纯浪费 |
| 生成 / 批量对话框（`useWorkflowTask`） | `200` | 展示最近过程 |
| 任务管理器「历史」展开、节点「详情」按钮（`useTaskLogs`） | `200` → 可升为全量 | 先给尾部片段，需要时点「查看全部」 |

## 六、开发与验证

- 清理逻辑单测：`server/src/db.test.ts`（最后 N 条顺序、**不删 running**、截止时间边界、分批、`VACUUM` 与 `freelist` 口径）。
- 清理器单测：`server/src/system/log-cleaner.test.ts`（终态/超期筛选、运行中保护、禁用与 `force`、配置热生效、失败不更新 `lastRunAt`）。
- 调度器单测：`server/src/system/log-scheduler.test.ts`（到期判定、启动补跑、禁用、幂等 start、stop、异常不外抛）。
- 降噪单测：`server/src/workflow-engine.test.ts`（状态不变 30 轮只写 1 条 + 心跳条数、进度变化逐条记录、终态里程碑保留、心跳读配置与失败回退）。
- 真实库演练（**操作副本，不碰真实库**）：`node scripts/verify-log-cleanup.mjs 14`（复制 `workflow.db` + WAL + SHM 到临时目录后在副本上清理，输出 PASS/FAIL 校验并删除副本）。这是**唯一**的验证脚本——仓库内不保留任何直接写真实库的造数脚本。

详见 [development.md](./development.md)。
