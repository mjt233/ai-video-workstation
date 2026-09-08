# 无引用资产与久远历史记录 扫描清理功能

> 实现记录：2026-09-08 · 状态：已实现并验证

## 1. 需求

1. **无引用自定义资产**：`assert/custom/` 下未被任何地方引用的文件可被扫描识别。
2. **久远历史记录**：资产画布节点产物历史 + 主要资产（角色、场景、道具及其衍生变体）历史中，归档时间超过用户设定阈值（默认 7 天）的条目可被识别。
3. 扫描结果可**预览查看**与**下载**（下载即下载该条目对应的原始文件）。
4. 结果按分组展示**文件大小**、**总大小**、**已选数据总大小**，支持勾选与快捷**全选 / 全不选 / 反选**。
5. 清理动作 = 移入**系统全局回收站**（不限定项目），再由用户手动清空或由**定时自动清理**按保留期清除。
6. 自动清理需用户可配置（默认 7 天执行一次），触发时在控制台打印日志。

## 2. 目录与配置约定

### 2.1 全局回收站

```
design/
├── {项目}/assert/custom/...              # 原始位置
└── .trash/                               # 系统全局回收站（保留目录）
    └── 20260908-201926/                  # 批次号 YYYYMMDD-HHmmss
        └── {项目}/custom/canvas/x.png    # 原 assert/ 内相对路径
```

- 原位置 = `design/{项目}/assert/{relPath}`；恢复为反向 rename（目标已存在则跳过）
- 条目时间 = 批次号时间（移入时刻），保留期从移入时刻起算
- `.trash` 不参与项目列表，创建/删除/导入同名项目被拒绝（`isReservedProjectName`）

### 2.2 系统设置

`server/config/system.json`（已加入 `.gitignore`）：

```jsonc
{
  "trash": {
    "autoClean": { "enabled": true, "intervalDays": 7, "retentionDays": 7 },
    "lastRunAt": "2026-09-08T12:17:39.609Z"
  }
}
```

## 3. 扫描口径

| 类型 | 口径 |
|------|------|
| 无引用自定义资产 | 遍历 `assert/custom/**`；引用来源为 `prompt/**` 全部文本文件（`stage.json` 的 `custom/...`、`canvas.json` 的加载节点 `assetPath` / 导演台素材路径、`refs.json`、变体元数据 `refs`/`baseImage` 等）经正则匹配并归一化为 `assert/custom/...`；命中文件或目录前缀即视为被引用（保守策略） |
| 久远历史记录 | 画布节点历史（`assert/scene/*/*/canvas/*/history/**`、`assert/stage/*/canvas/*/*/history/**`）、角色历史（`assert/character/**/history/**`）、场景历史（`assert/stage/**/history/**`）、道具历史（`assert/prop/**/history/**`）；归档时间优先取文件名 `YYYYMMDD-HHmmss`，失败回退 mtime；早于阈值（默认 7 天）才纳入；**不含**分镜产物历史 |

所属资产推导：`A/history/{stem}/x.ext` → `A/{stem}.ext`。

## 4. API

### 项目侧

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/assets/:project/cleanup/scan` | body `{ olderThanDays }`（1~3650，默认 7）→ 分组结果 + 总大小 + 统计 |
| POST | `/api/assets/:project/cleanup/trash` | body `{ paths }` → 移入全局回收站（移入前二次校验引用，仍被引用则跳过） |

预览/下载复用 `GET /api/fs/:project/*`。

### 系统侧

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/system/settings` | 系统设置 + 回收站统计 + 下次执行时间 |
| PUT | `/api/system/settings` | 局部更新 `trash.autoClean` |
| GET | `/api/system/trash` | 全局回收站（批次分组、项目名、大小、剩余保留天数） |
| POST | `/api/system/trash/restore` | 恢复条目 |
| POST | `/api/system/trash/purge` | 彻底删除（`items` / `batchId` / `all`） |
| POST | `/api/system/trash/auto-clean` | 立即执行一次超期清理（忽略开关，沿用保留期） |

## 5. 自动清理

- `server/src/system/trash-scheduler.ts`：每 1 小时轮询配置，距上次执行达到间隔即执行；启动后 60 秒补跑一次；进程内重入保护；配置热生效
- `server/src/system/trash-cleaner.ts`：筛选超期条目（`>` 保留期）→ 彻底删除 → 更新 `lastRunAt`
- 日志前缀 `[trash-auto-clean]`，仅「状态变化 / 真正触发 / 执行失败」时打印

## 6. 界面

| 入口 | 内容 |
|------|------|
| 项目设置面板 →「存储清理」页签 | 阈值输入（默认 7 天）→ 扫描 → 分组结果（路径/大小/时间/所属资产/预览/下载）→ 汇总条（总数、总大小、已选数、已选大小、全选/全不选/反选）→「清理选中项」（confirm 后移入回收站）→「回收站设置」跳转 |
| 系统设置对话框 →「系统设置」页签 → 子类「回收站」 | 自动清理开关/间隔/保留期 + 上次/下次执行时间 + 立即清理一次；回收站内容按批次展开，支持恢复、彻底删除、删除批次、清空回收站 |

## 7. 关键文件

服务端：`assets/cleanup.ts`、`assets/trash.ts`、`system/system-settings.ts`、`system/trash-cleaner.ts`、`system/trash-scheduler.ts`、`routes/cleanup.ts`、`routes/system.ts`（`index.ts` 注册 + 启动调度器）；`routes/fs.ts`、`routes/project-port.ts`、`assets/paths.ts`（保留目录过滤）。

前端：`api/cleanup.ts`、`api/system.ts`、`utils/formatBytes.ts`、`utils/relativeTime.ts`、`composables/useSystemSettings.ts`、`components/cleanup/*`、`components/system-settings/*`、`ProjectPanel.vue`、`SystemSettingsDialog.vue`、`App.vue`。

## 8. 验证

- 服务端单测：`assets/cleanup.test.ts`、`assets/trash.test.ts`、`system/system-settings.test.ts`、`system/trash-cleaner.test.ts`、`routes/project-port.test.ts`（保留目录）
- 前端单测：`utils/formatBytes.test.ts`、`utils/relativeTime.test.ts`
- 端到端（临时项目，验证后删除）：扫描命中/过滤正确 → 移入回收站落位 `design/.trash/{批次}/{项目}/...` → 恢复成功 → 按批次彻底删除 → `GET /api/projects` 不列出 `.trash`
- 界面验证：真实项目扫描 37 项 / 52.6 MB，分组与汇总正确；全选/反选/全不选联动；系统设置「回收站」子类配置读写、立即清理一次均正常
