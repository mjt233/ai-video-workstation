# 资产画布 Phase 1：后端文件操作基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 放宽 `fs.ts` 的 mkdir/rename/upload/delete 限制到 `assert/` 前缀，并新增 `copy` 端点，为画布资产区（`assert/{scope}/canvas/`）提供完整的文件操作能力。

**Architecture:** 项目遵循「文件系统即数据库」。后端 `server/src/routes/fs.ts` 提供统一的 `/api/fs/:project/*` 文件读写，其中 mkdir/rename/upload/delete 目前硬编码仅允许 `assert/custom/` 前缀。本计划将这 4 个操作的校验放宽到 `assert/` 前缀（引入 `ASSERT_PREFIX` 常量消除重复），并在通配写入路由之前注册一个新的 `POST /api/fs/:project/copy` 端点（复制文件/目录，用于「设为分镜场景图」「复制画布到其他分镜」——`rename` 是移动，无法满足复制语义）。前端 `frontend/src/api/client.ts` 同步增加 `copyFs` 封装。

**Tech Stack:** Express 4 + TypeScript（服务端，`tsx` 运行）、axios（前端 API 封装）、Node 内置 `fs/promises`（含 `fs.cp`，需 Node ≥ 16.7）。

**验证约定（重要）：** 本项目**没有测试框架**（前后端 package.json 均无 vitest/jest）。因此每个任务的验证方式为：`npm run typecheck` + `npm run lint` + 使用 dev server 手动 curl 验证。遵循 AGENTS.md：修改代码后必须执行 `npm run typecheck` 与 `npm run lint`。

**范围检查：** 本计划只覆盖后端文件操作基础（Phase 1）。前端画布核心（vue-flow、数据模型、持久化）与节点交互（三种节点、连线、自动搭画布、面板集成）为后续独立计划（Phase 2 / Phase 3），不在本计划内。

**相关规格：** `docs/plans/canva.md` §10.4（后端 API 变更）与「已确认的设计决策」第 6 条。

---

### Task 1: 引入 `ASSERT_PREFIX` 常量

**Files:**
- Modify: `server/src/routes/fs.ts`（文件顶部常量区）

- [ ] **Step 1: 在文件顶部常量区新增 `ASSERT_PREFIX`**

在 `WRITABLE_ROOT_FILES` 定义之后、`isWritableRelPath` 之前插入：

```ts
const WRITABLE_PREFIXES = ['prompt', 'assert'];
const WRITABLE_ROOT_FILES = ['overview.md', 'project.json'];

/** assert/ 前缀：画布资产区（assert/{scope}/canvas/ 等）均在此前缀下 */
const ASSERT_PREFIX = 'assert/';
```

- [ ] **Step 2: 运行类型检查与 lint 确认无回归**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\server
npm run typecheck
npm run lint
```

Expected: 两个命令均无错误（lint 在根目录 `package.json`，见下方注）。

> 注：`npm run lint` 的脚本位于仓库根 `package.json`（ESLint flat config 覆盖前后端）。若在 `server/` 下无 `lint` 脚本，则在仓库根执行 `npm run lint`。

- [ ] **Step 3: 提交**

```bash
git add server/src/routes/fs.ts
git commit -m "feat: fs 路由引入 ASSERT_PREFIX 常量"
```

---

### Task 2: 放宽 mkdir 限制到 `assert/`

**Files:**
- Modify: `server/src/routes/fs.ts`（mkdir 处理器）

- [ ] **Step 1: 修改 mkdir 校验**

找到 mkdir 处理器中的校验段（原文）：

```ts
    const normalized = dirRelPath.replace(/\\/g, '/');
    if (!normalized.startsWith('assert/custom/')) {
      res.status(403).json({ error: '仅支持 assert/custom/ 下创建目录' });
      return;
    }
```

替换为：

```ts
    const normalized = dirRelPath.replace(/\\/g, '/');
    if (!normalized.startsWith(ASSERT_PREFIX)) {
      res.status(403).json({ error: '仅支持 assert/ 下创建目录' });
      return;
    }
```

- [ ] **Step 2: 类型检查与 lint**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\server
npm run typecheck
cd c:\Users\xiaotao\code\ai-video-workstation
npm run lint
```

Expected: 无错误。

- [ ] **Step 3: 手动验证（dev server 需已运行，端口 3001）**

Run:
```powershell
$p = [uri]::EscapeDataString('AI的第一天')
$body = @{ path = 'assert/scene/1/1/canvas/t1' } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/mkdir" -Method Post -Body $body -ContentType 'application/json'
```

Expected: 返回 `{ success = True }`（此前会返回 403）。

清理（同时验证 delete 后续任务前先手动清理）：
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/assert/scene/1/1/canvas/t1" -Method Delete
```
Expected: `{ success = True }`。

- [ ] **Step 4: 提交**

```bash
git add server/src/routes/fs.ts
git commit -m "feat: fs mkdir 限制放宽到 assert/ 前缀"
```

---

### Task 3: 放宽 rename 限制到 `assert/`

**Files:**
- Modify: `server/src/routes/fs.ts`（rename 处理器）

- [ ] **Step 1: 修改 rename 校验**

找到 rename 处理器中的校验段（原文）：

```ts
    const fromNorm = from.replace(/\\/g, '/');
    const toNorm = to.replace(/\\/g, '/');
    if (!fromNorm.startsWith('assert/custom/') || !toNorm.startsWith('assert/custom/')) {
      res.status(403).json({ error: '仅支持 assert/custom/ 下的重命名' });
      return;
    }
```

替换为：

```ts
    const fromNorm = from.replace(/\\/g, '/');
    const toNorm = to.replace(/\\/g, '/');
    if (!fromNorm.startsWith(ASSERT_PREFIX) || !toNorm.startsWith(ASSERT_PREFIX)) {
      res.status(403).json({ error: '仅支持 assert/ 下的重命名' });
      return;
    }
```

- [ ] **Step 2: 类型检查与 lint**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\server
npm run typecheck
cd c:\Users\xiaotao\code\ai-video-workstation
npm run lint
```

Expected: 无错误。

- [ ] **Step 3: 手动验证**

Run:
```powershell
$p = [uri]::EscapeDataString('AI的第一天')
$body = @{ path = 'assert/scene/1/1/canvas/ren1' } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/mkdir" -Method Post -Body $body -ContentType 'application/json'
$body2 = @{ from = 'assert/scene/1/1/canvas/ren1'; to = 'assert/scene/1/1/canvas/ren2' } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/rename" -Method Post -Body $body2 -ContentType 'application/json'
```

Expected: mkdir 成功；rename 返回 `{ success = True }`（此前 rename 会返回 403）。

清理：
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/assert/scene/1/1/canvas/ren2" -Method Delete
```

- [ ] **Step 4: 提交**

```bash
git add server/src/routes/fs.ts
git commit -m "feat: fs rename 限制放宽到 assert/ 前缀"
```

---

### Task 4: 放宽 upload 限制到 `assert/`

**Files:**
- Modify: `server/src/routes/fs.ts`（upload 处理器）

- [ ] **Step 1: 修改 upload 校验**

找到 upload 处理器中的校验段（原文）：

```ts
      const normalized = destRelPath.replace(/\\/g, '/');
      if (!normalized.startsWith('assert/custom/')) {
        res.status(403).json({ error: '仅支持上传到 assert/custom/ 下' });
        return;
      }
```

替换为：

```ts
      const normalized = destRelPath.replace(/\\/g, '/');
      if (!normalized.startsWith(ASSERT_PREFIX)) {
        res.status(403).json({ error: '仅支持上传到 assert/ 下' });
        return;
      }
```

- [ ] **Step 2: 类型检查与 lint**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\server
npm run typecheck
cd c:\Users\xiaotao\code\ai-video-workstation
npm run lint
```

Expected: 无错误。

- [ ] **Step 3: 手动验证**

先准备一个本地测试文件（任意小图片，如 `C:\temp\upload-test.png`，可用 PowerShell 生成 1×1 PNG 或复用项目中任意图片）。

Run:
```powershell
$p = [uri]::EscapeDataString('AI的第一天')
$target = "http://localhost:3001/api/fs/$p/upload"
curl.exe -s -X POST $target -F "path=assert/scene/1/1/canvas/upload-test.png" -F "file=@C:\temp\upload-test.png"
```

Expected: 返回 `{"success":true,"path":"assert/scene/1/1/canvas/upload-test.png"}`（此前 upload 到 `assert/scene/...` 会返回 403）。

清理：
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/assert/scene/1/1/canvas/upload-test.png" -Method Delete
```

- [ ] **Step 4: 提交**

```bash
git add server/src/routes/fs.ts
git commit -m "feat: fs upload 限制放宽到 assert/ 前缀"
```

---

### Task 5: 放宽 delete 限制到 `assert/`

**Files:**
- Modify: `server/src/routes/fs.ts`（delete 处理器）

- [ ] **Step 1: 修改 delete 校验**

找到 delete 处理器中的校验段（原文）：

```ts
    const normalized = relPath.replace(/\\/g, '/');
    if (!normalized.startsWith('assert/custom/')) {
      res.status(403).json({ error: '仅支持删除 assert/custom/ 下的内容' });
      return;
    }
```

替换为：

```ts
    const normalized = relPath.replace(/\\/g, '/');
    if (!normalized.startsWith(ASSERT_PREFIX)) {
      res.status(403).json({ error: '仅支持删除 assert/ 下的内容' });
      return;
    }
```

- [ ] **Step 2: 类型检查与 lint**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\server
npm run typecheck
cd c:\Users\xiaotao\code\ai-video-workstation
npm run lint
```

Expected: 无错误。

- [ ] **Step 3: 手动验证**

Run:
```powershell
$p = [uri]::EscapeDataString('AI的第一天')
$body = @{ path = 'assert/scene/1/1/canvas/del1' } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/mkdir" -Method Post -Body $body -ContentType 'application/json'
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/assert/scene/1/1/canvas/del1" -Method Delete
```

Expected: mkdir 成功；delete 返回 `{ success = True }`（此前 delete 非 `assert/custom/` 路径返回 403）。

- [ ] **Step 4: 提交**

```bash
git add server/src/routes/fs.ts
git commit -m "feat: fs delete 限制放宽到 assert/ 前缀"
```

---

### Task 6: 新增 `POST /api/fs/:project/copy` 端点

**Files:**
- Modify: `server/src/routes/fs.ts`（在 upload 处理器之后、通配写入路由之前插入）

- [ ] **Step 1: 在通配写入路由之前插入 copy 处理器**

在 `// ── 文件系统：写入文本内容（通配路由，放在具体路由之后） ─────────` 这一行**之前**插入（紧跟在 upload 处理器结束后）：

```ts
// ── 文件系统：复制文件/目录（须在 /* 路由前注册） ────────────────

fsRouter.post('/fs/:project/copy', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const { from, to } = req.body as { from?: string; to?: string };
    if (!from || !to) {
      res.status(400).json({ error: 'from 与 to 必填' });
      return;
    }
    const fromNorm = from.replace(/\\/g, '/');
    const toNorm = to.replace(/\\/g, '/');
    if (!fromNorm.startsWith(ASSERT_PREFIX) || !toNorm.startsWith(ASSERT_PREFIX)) {
      res.status(403).json({ error: '仅支持复制 assert/ 下的内容' });
      return;
    }
    const fromFull = path.resolve(DESIGN_DIR, project, fromNorm);
    const toFull = path.resolve(DESIGN_DIR, project, toNorm);
    const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;
    if (!fromFull.startsWith(projectRoot) || !toFull.startsWith(projectRoot)) {
      res.status(403).json({ error: 'Path traversal denied' });
      return;
    }
    await fs.mkdir(path.dirname(toFull), { recursive: true });
    await fs.cp(fromFull, toFull, { recursive: true });
    res.json({ success: true, from: fromNorm, to: toNorm });
  } catch (err) {
    const e = err as ErrorWithCode;
    if (e.code === 'ENOENT') {
      res.status(404).json({ error: '源路径不存在' });
    } else {
      console.error('Failed to copy fs:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});
```

> **关键顺序说明**：该路由必须在 `fsRouter.post('/fs/:project/*', ...)` 通配路由**之前**注册，否则 `/fs/:project/copy` 会被通配路由当作「写文本内容」处理。现有 mkdir/rename/upload 也是同样的顺序约定。

- [ ] **Step 2: 类型检查与 lint**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\server
npm run typecheck
cd c:\Users\xiaotao\code\ai-video-workstation
npm run lint
```

Expected: 无错误。

- [ ] **Step 3: 手动验证（复制目录 + 复制文件 + 负向用例）**

Run（复制目录）:
```powershell
$p = [uri]::EscapeDataString('AI的第一天')
$body = @{ path = 'assert/scene/1/1/canvas/src' } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/mkdir" -Method Post -Body $body -ContentType 'application/json'
$body2 = @{ from = 'assert/scene/1/1/canvas/src'; to = 'assert/scene/1/1/canvas/dst' } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/copy" -Method Post -Body $body2 -ContentType 'application/json'
```

Expected: copy 返回 `{ success = True, from = ..., to = ... }`；随后 `GET /api/fs/$p/assert/scene/1/1/canvas` 目录列表应同时出现 `src` 与 `dst`。

Run（负向用例：源不在 assert/ 下应 403）:
```powershell
$body3 = @{ from = 'prompt/scene/1/1/overview.json'; to = 'assert/scene/1/1/canvas/bad' } | ConvertTo-Json
try { Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/copy" -Method Post -Body $body3 -ContentType 'application/json' } catch { $_.Exception.Response.StatusCode.value__ }
```

Expected: 输出 `403`。

清理:
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/assert/scene/1/1/canvas/src" -Method Delete
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/assert/scene/1/1/canvas/dst" -Method Delete
```

- [ ] **Step 4: 提交**

```bash
git add server/src/routes/fs.ts
git commit -m "feat: 新增 fs copy 端点支持 assert/ 下复制"
```

---

### Task 7: 前端 `client.ts` 增加 `copyFs` 封装

**Files:**
- Modify: `frontend/src/api/client.ts`（在 `renameFs` 之后插入）

- [ ] **Step 1: 新增 `copyFs` 函数**

在 `renameFs` 定义之后插入：

```ts
/** 复制文件或目录（源/目标均须在 assert/ 下，用于画布资产复制、设为分镜场景图等） */
export async function copyFs(project: string, from: string, to: string): Promise<{ success: boolean; from: string; to: string }> {
  const { data } = await client.post<{ success: boolean; from: string; to: string }>(`/fs/${project}/copy`, { from, to })
  return data
}
```

- [ ] **Step 2: 类型检查与 lint**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation\frontend
npm run typecheck
cd c:\Users\xiaotao\code\ai-video-workstation
npm run lint
```

Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/api/client.ts
git commit -m "feat: 前端新增 copyFs API 封装"
```

---

### Task 8: 全量回归验证

**Files:**
- 无（纯验证）

- [ ] **Step 1: 全仓类型检查与 lint**

Run:
```powershell
cd c:\Users\xiaotao\code\ai-video-workstation
npm run typecheck
npm run lint
```

Expected: 均无错误。

- [ ] **Step 2: 端到端手动验证**

启动 dev server（若未运行）：`npm run dev`（服务端 3001 + 前端 5233）。

Run:
```powershell
$p = [uri]::EscapeDataString('AI的第一天')
# 1) mkdir 画布资产区
$b1 = @{ path = 'assert/scene/1/1/canvas/e2e' } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/mkdir" -Method Post -Body $b1 -ContentType 'application/json'
# 2) 往画布资产区写入一个文本文件（验证通配写入路由仍正常、且 copy 路由未被吞）
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/assert/scene/1/1/canvas/e2e/a.txt" -Method Post -Body (@{ content = 'hello' } | ConvertTo-Json) -ContentType 'application/json'
# 3) copy 目录
$b2 = @{ from = 'assert/scene/1/1/canvas/e2e'; to = 'assert/scene/1/1/canvas/e2e-copy' } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/copy" -Method Post -Body $b2 -ContentType 'application/json'
# 4) 读取复制出的文件，确认内容一致
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/assert/scene/1/1/canvas/e2e-copy/a.txt"
# 5) 清理
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/assert/scene/1/1/canvas/e2e" -Method Delete
Invoke-RestMethod -Uri "http://localhost:3001/api/fs/$p/assert/scene/1/1/canvas/e2e-copy" -Method Delete
```

Expected: mkdir / 写入 / copy 均 `success=True`；读取返回 `hello`；清理成功。

- [ ] **Step 3: 提交（如验证中发现并修复问题）**

```bash
git add -A
git commit -m "fix: 回归验证修复"
```

若无问题则跳过本步。

---

## 后续阶段（独立计划，不在本计划内）

- **Phase 2 — 前端画布核心**：安装 `@vue-flow/core`；`CanvasData` 数据模型与 `canvas.json` 读写（复用 `/fs` API）；类型化端口（`DataType`/`Port`）；`useCanvasAssetUrl` 预览工具；画布状态 store 与防抖保存。
- **Phase 3 — 节点与交互**：三种节点（加载图片 / 生成图片 / 文本）的 bodyComponent 与 editorComponent；连线交互（+ 号拖拽、类型/循环校验）；撤销重做；自动搭画布（读 `stage.json`）；「设为分镜场景图」；面板 Tab 集成。

## Self-Review

- **Spec coverage**：canva.md §10.4 要求的 4 项放宽（Task 2–5）+ copy 端点（Task 6）+ 前端封装（Task 7）均已覆盖；§10.6 防逃逸校验在 copy 中保留（Task 6 Step 1）。
- **Placeholder scan**：所有步骤均含实际代码与命令，无 TBD/TODO。
- **Type consistency**：`copyFs` 返回类型与服务端 `{ success, from, to }` 一致；`ASSERT_PREFIX` 命名在全部 5 处（mkdir/rename/upload/delete/copy）一致。
