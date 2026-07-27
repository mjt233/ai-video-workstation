# AGENTS.md — ai-video-workstation

## 快速启动
- `npm run dev` — 同时启动服务端 (3001) 和前端 (5233)
- `npm run build` — 仅构建前端
- `npm run start` — 生产模式：Express 托管 `frontend/dist/`，端口 3001
- 前端开发服务器代理 `/api` → `localhost:3001`

## 技术栈
- **服务端：** Express (ESM, `type: "module"`)，单依赖，纯 JS
- **前端：** Vue 3 + Vuetify 3 + vue-router + axios，Vite 构建，纯 JS（无 TypeScript）
- **整个仓库没有测试、没有 lint、没有格式化、没有 CI**

## 数据：文件系统即数据库
所有项目资产存放在 `design/{project}/` 下：
```
prompt/
  character/{name}/{overview,appearance,voice}.md
  stage/{stage}/{stage}-{subscene}.md
  scene/{episode}/{shot}/{overview,stage,script,prompt}.{md,json}
assert/  (图片, 音频)
overview.md
```
- API：`GET /api/projects`、`GET /api/fs/:project/*`（目录列表或文件读取）、`POST /api/fs/:project/*`（写入）
- 写入仅限于 `prompt/` 和 `assert/` 前缀
- 前端状态完全由 URL 查询参数驱动：`project`、`type`、`name`、`episode`、`shot`

## 约定
- 所有 UI 文字、文档、资产和提交信息使用**中文**
- 服务端开发时使用 `node --watch` 自动重启
- 图片/音频文件以二进制流传输；文本/markdown/JSON 以 UTF-8 传输
- 资产管理 Python 脚本位于 `.claude/skills/create-video-script/scripts/`
