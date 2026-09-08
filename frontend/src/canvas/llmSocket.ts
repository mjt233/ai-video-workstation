/**
 * LLM 会话 WS 客户端（兼容入口）。
 *
 * 统一任务架构落地后，原 LLM 专属 WS 客户端已升级为 `canvas/taskSocket.ts`
 * （同一连接同时承载 全部任务列表 + LLM 流式事件）。本文件仅做**兼容再导出**，
 * 让既有 `llmSocket.xxx` 调用点无需一次性改动；新代码请直接使用 `taskSocket`。
 */

export {
  taskSocket,
  taskSocket as llmSocket,
  type TaskInfo,
  type TaskType,
  type TaskStatus,
  type TaskUpdateListener,
  type LlmCanvasTarget,
  type LlmSessionInfo,
  type LlmSnapshotInfo,
  type LlmFinishedInfo,
  type LlmTaskEvent,
  type LlmTaskHandler,
  type LlmFinishedListener,
} from './taskSocket'
