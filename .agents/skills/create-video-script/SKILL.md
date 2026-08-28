---
name: create-video-script
description: 用于AI视频制作前期阶段的剧本全局大纲与原型设计，涵盖美术风格、世界观设定、角色设计（适配qwen-image文生图与qwen-3-tts语音合成）、场景设计及项目资产输出。需用户手动触发。
disable-model-invocation: true
---

# 创建视频剧本全局大纲说明

本技能文档拆分为以下子文档，按流程顺序阅读：

| # | 文档 | 内容 |
|---|------|------|
| 1 | [`01-preset.md`](./01-preset.md) | 前置设定 — 通过问答引导用户确立项目顶层定位（目标受众、情感/色彩基调、美术风格、画面比例、剧情方向等） |
| 2 | [`02-content-design.md`](./02-content-design.md) | 内容设计 — 美术风格、剧情概要、世界观、角色设计、场景设计、分镜设计原则 |
| 3 | [`03-asset-output.md`](./03-asset-output.md) | 资产原型输出 — 集数概念、多项目支持、目录结构、模板规范（角色 overview.md / appearance.md / voice.md、分镜 overview.json）、分镜资产输出、剧本（大纲/分集）读取与受控修改约定 |
| 4 | [`04-script-tools.md`](./04-script-tools.md) | 分镜脚本工具参考 — Python 脚本用法（set_shot_overview / add_stage / add_script / validate 等） |
| 5 | [`05-optimization-guide.md`](./05-optimization-guide.md) | 分镜生成优化指南 — 叙事拆分策略、LTX-2.3 优化要点、分镜数量建议 |
| 6 | [`06-self-review.md`](./06-self-review.md) | 输出自我审查 — 产出资产的质量检查清单 |

## 总流程

1. 按 [`01-preset.md`](./01-preset.md) 引导用户完成前置设定决策
2. 按 [`02-content-design.md`](./02-content-design.md) 设计美术风格、剧情、世界观、角色、场景和分镜原则（若项目已有剧本，先按 [`03-asset-output.md`](./03-asset-output.md#剧本资产大纲与分集) 读取大纲/对应分集正文，剧情与对白以剧本为准）
3. 输出 `overview.md` 总览让用户确认
4. 用户确认后，按 [`03-asset-output.md`](./03-asset-output.md) 生成角色/场景/分镜的原型资产
5. 使用 [`04-script-tools.md`](./04-script-tools.md) 中的 Python 脚本管理分镜 JSON 资产
6. 参考 [`05-optimization-guide.md`](./05-optimization-guide.md) 优化分镜设计质量
7. 按 [`06-self-review.md`](./06-self-review.md) 进行输出自我审查