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

/** 节点产物路径：assert/{scope}/canvas/{nodeId}/v{n}.jpg */
export function canvasNodeAssetPath(scope: CanvasScope, nodeId: string, version: number): string {
  return `${canvasAssetDir(scope)}/${nodeId}/v${version}.jpg`
}
