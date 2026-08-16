/**
 * 画布相关路径计算。
 * 画布定义文件存 prompt/ 下；生成产物存 assert/ 的画布子目录。
 */

/** 画布作用域：用于定位画布定义与产物目录 */
export interface CanvasScope {
  kind: 'stage' | 'scene'
  /** stage 时为场景名；scene 时为集数 */
  primary: string
  /** scene 时为分镜号 */
  secondary?: string
  /** stage 时为子场景标签（场景画布按子场景拆分） */
  label?: string
}

/** 场景画布定义文件：prompt/stage/{场景名}/canvas/{子场景标签}.json */
export function stageCanvasRelPath(stage: string, label: string): string {
  return `prompt/stage/${stage}/canvas/${label}.json`
}

/** 分镜画布定义文件：prompt/scene/{集数}/{分镜}/canvas.json */
export function sceneCanvasRelPath(episode: string, shot: string): string {
  return `prompt/scene/${episode}/${shot}/canvas.json`
}

/** 画布生成产物目录：assert/{scope}/canvas/ */
export function canvasAssetDir(scope: CanvasScope): string {
  if (scope.kind === 'stage') {
    return `assert/stage/${scope.primary}/canvas${scope.label ? `/${scope.label}` : ''}`
  }
  return `assert/scene/${scope.primary}/${scope.secondary ?? ''}/canvas`
}

/**
 * 节点产物路径（固定文件名）：assert/{scope}/canvas/{nodeId}/output.{ext}。
 *
 * 画布节点产物统一为固定文件名（对齐分镜场景图/自定义资产的「固定路径 + 服务端历史目录」模式）：
 * "当前结果"即文件系统事实，前端按 scope+nodeId+扩展名恒等推导，不再存储版本号元数据。
 * 历史版本由服务端 assets/history.ts 管理（{nodeId}/history/output/{时间戳}.{ext}）。
 *
 * @param scope 画布作用域
 * @param nodeId 节点 id
 * @param ext 产物扩展名（无点号，如 jpg / mp4 / png / flac）
 * @returns assert 相对路径
 */
export function canvasNodeOutputPath(scope: CanvasScope, nodeId: string, ext: string): string {
  return `${canvasAssetDir(scope)}/${nodeId}/output.${ext}`
}

/**
 * 节点产物路径（版本化文件名，仅迁移/旧数据兼容）：
 * assert/{scope}/canvas/{nodeId}/v{n}.jpg。
 * 新代码一律使用 canvasNodeOutputPath（固定文件名）。
 *
 * @param scope 画布作用域
 * @param nodeId 节点 id
 * @param version 版本号
 * @returns assert 相对路径
 * @deprecated 产物改为固定文件名，仅历史数据迁移与旧代码兼容使用
 */
export function canvasNodeAssetPath(scope: CanvasScope, nodeId: string, version: number): string {
  return `${canvasAssetDir(scope)}/${nodeId}/v${version}.jpg`
}
