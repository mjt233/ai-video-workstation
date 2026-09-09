/**
 * 画布蓝图 API 层（`/api/blueprints`）。
 *
 * 作用域：
 * - `scope='global'`：全局蓝图（`server/config/blueprints/{id}.json`）；
 * - `scope='project'` + `project`：项目级蓝图（`design/{project}/prompt/blueprint/{id}.json`）。
 *
 * 类型与纯逻辑（捕获/实例化/迁移）见 `canvas/blueprint.ts`；本模块只负责 HTTP 传输与错误映射。
 */

import client from './client'
import type { AxiosError } from 'axios'
import { CanvasVersionError } from '../canvas/api'
import {
  migrateBlueprint,
  type BlueprintListItem,
  type BlueprintPayload,
  type CanvasBlueprint,
} from '../canvas/blueprint'

/** 蓝图作用域 */
export type BlueprintScope = 'global' | 'project'

/** 蓝图定位（作用域 + 项目） */
export interface BlueprintRef {
  /** 作用域 */
  scope: BlueprintScope
  /** 项目名（scope='project' 时必填） */
  project?: string
}

/** 服务端错误体 */
interface BlueprintErrorBody {
  error?: string
  code?: string
  currentRev?: number
  expectedRev?: number
  existingId?: string
}

/**
 * 蓝图名称冲突错误（服务端 409 EXISTS）。
 *
 * 携带既有蓝图 id，供调用方询问用户是否覆盖（覆盖 = 用该 id 执行更新）。
 */
export class BlueprintExistsError extends Error {
  /** 同名蓝图 id */
  existingId: string

  /**
   * @param message 服务端错误文案
   * @param existingId 同名蓝图 id
   */
  constructor(message: string, existingId: string) {
    super(message)
    this.name = 'BlueprintExistsError'
    this.existingId = existingId
  }
}

/**
 * 统一的蓝图接口错误映射：
 * - 409 VERSION_CONFLICT → CanvasVersionError（复用画布冲突处理：停止自动保存 + 冲突横幅）；
 * - 409 EXISTS → BlueprintExistsError（携带 existingId）；
 * - 其余原样抛出（axios 错误已在拦截器打印日志）。
 *
 * @param e 捕获到的异常
 * @throws 始终抛出映射后的错误
 */
function rethrow(e: unknown): never {
  const ax = e as AxiosError<BlueprintErrorBody>
  const body = ax.response?.data
  if (ax.response?.status === 409 && body?.code === 'VERSION_CONFLICT') {
    throw new CanvasVersionError(
      body.error ?? '蓝图保存冲突：该蓝图已被其他人修改',
      Number(body.currentRev) || 0,
      Number(body.expectedRev) || 0,
    )
  }
  if (ax.response?.status === 409 && body?.code === 'EXISTS') {
    throw new BlueprintExistsError(body.error ?? '同名蓝图已存在', String(body.existingId ?? ''))
  }
  throw e
}

/**
 * 列出指定作用域下的蓝图摘要。
 *
 * @param ref 蓝图定位
 * @returns 摘要列表（按更新时间倒序）
 */
export async function listBlueprints(ref: BlueprintRef): Promise<BlueprintListItem[]> {
  const { data } = await client.get<{ blueprints: BlueprintListItem[] }>('/blueprints', {
    params: { scope: ref.scope, project: ref.project },
  })
  return data.blueprints
}

/**
 * 读取单个蓝图（含 rev；结构经 migrateBlueprint 容错规范化）。
 *
 * @param ref 蓝图定位
 * @param id 蓝图 id
 * @returns 蓝图内容
 */
export async function getBlueprint(ref: BlueprintRef, id: string): Promise<CanvasBlueprint> {
  const { data } = await client.get<{ blueprint: unknown }>(`/blueprints/${encodeURIComponent(id)}`, {
    params: { scope: ref.scope, project: ref.project },
  })
  const blueprint = migrateBlueprint(data.blueprint)
  if (!blueprint) throw new Error('蓝图文件结构非法，无法读取')
  return blueprint
}

/**
 * 创建蓝图。
 *
 * @param ref 蓝图定位
 * @param input 名称/描述/资产项目/内容载荷/是否覆盖同名
 * @returns 创建的蓝图内容
 * @throws BlueprintExistsError 同名且未指定覆盖
 */
export async function createBlueprint(
  ref: BlueprintRef,
  input: {
    name: string
    description?: string
    assetProject?: string | null
    payload: BlueprintPayload
    overwrite?: boolean
  },
): Promise<CanvasBlueprint> {
  try {
    const { data } = await client.post<{ blueprint: unknown }>('/blueprints', {
      scope: ref.scope,
      project: ref.project,
      name: input.name,
      description: input.description ?? '',
      assetProject: input.assetProject ?? null,
      payload: input.payload,
      overwrite: input.overwrite === true,
    })
    const blueprint = migrateBlueprint(data.blueprint)
    if (!blueprint) throw new Error('服务端返回的蓝图结构非法')
    return blueprint
  } catch (e) {
    rethrow(e)
  }
}

/**
 * 局部更新蓝图（CAS：`expectedRev` 必须等于服务端当前 rev，或 `force=true`）。
 *
 * @param ref 蓝图定位
 * @param id 蓝图 id
 * @param patch 更新字段（未提供保持原值）
 * @param opts 版本选项（expectedRev / force）
 * @returns 更新后的蓝图内容
 * @throws CanvasVersionError 版本冲突；BlueprintExistsError 改名撞名
 */
export async function updateBlueprint(
  ref: BlueprintRef,
  id: string,
  patch: {
    name?: string
    description?: string
    assetProject?: string | null
    nodes?: unknown
    connections?: unknown
    groups?: unknown
  },
  opts: { expectedRev?: number; force?: boolean } = {},
): Promise<CanvasBlueprint> {
  try {
    const { data } = await client.put<{ blueprint: unknown }>(`/blueprints/${encodeURIComponent(id)}`, {
      scope: ref.scope,
      project: ref.project,
      ...patch,
      expectedRev: opts.expectedRev,
      force: opts.force === true,
    })
    const blueprint = migrateBlueprint(data.blueprint)
    if (!blueprint) throw new Error('服务端返回的蓝图结构非法')
    return blueprint
  } catch (e) {
    rethrow(e)
  }
}

/**
 * 删除蓝图。
 *
 * @param ref 蓝图定位
 * @param id 蓝图 id
 */
export async function deleteBlueprint(ref: BlueprintRef, id: string): Promise<void> {
  await client.delete(`/blueprints/${encodeURIComponent(id)}`, {
    params: { scope: ref.scope, project: ref.project },
  })
}

/**
 * 导入蓝图（`data` 为蓝图文件内容，服务端会重新生成 id）。
 *
 * @param ref 目标定位
 * @param data 蓝图文件内容（原始 JSON 对象）
 * @param opts 同名时是否覆盖
 * @returns 导入后的蓝图内容
 * @throws BlueprintExistsError 同名且未指定覆盖
 */
export async function importBlueprint(
  ref: BlueprintRef,
  data: unknown,
  opts: { overwrite?: boolean } = {},
): Promise<CanvasBlueprint> {
  try {
    const { data: res } = await client.post<{ blueprint: unknown }>('/blueprints/import', {
      scope: ref.scope,
      project: ref.project,
      data,
      overwrite: opts.overwrite === true,
    })
    const blueprint = migrateBlueprint(res.blueprint)
    if (!blueprint) throw new Error('服务端返回的蓝图结构非法')
    return blueprint
  } catch (e) {
    rethrow(e)
  }
}

/**
 * 画布编辑器（蓝图模式）的持久化适配器：读取/保存蓝图内容为画布数据结构。
 *
 * 蓝图与画布定义的差异（见 docs/canvas/blueprint.md）：
 * - 蓝图不含 `kind`（编辑器内部固定用 `stage` 占位，不影响渲染）；
 * - 画布侧只读写 nodes/connections/groups 三个字段，名称/描述/资产项目由编辑器头部单独保存。
 *
 * @param ref 蓝图定位
 * @param id 蓝图 id
 * @param options.assetProject 资产项目取值器（提供时每次 save() 一并写入 `assetProject`，
 *   使「资产项目」选择与内容在**同一次 CAS 请求**中落盘；蓝图编辑器手动保存模式使用）
 * @returns 适配器：load() 读取为画布数据；save() 以 CAS 写回蓝图文件
 */
export function blueprintCanvasPersistence(
  ref: BlueprintRef,
  id: string,
  options: { assetProject?: () => string | null } = {},
) {
  return {
    /**
     * 读取蓝图内容并转换为画布数据。
     *
     * @returns 画布数据与版本号；蓝图不存在时返回 null
     */
    async load(): Promise<{ canvas: { nodes: CanvasBlueprint['nodes']; connections: CanvasBlueprint['connections']; groups: CanvasBlueprint['groups'] }; rev: number } | null> {
      try {
        const blueprint = await getBlueprint(ref, id)
        return {
          canvas: {
            nodes: blueprint.nodes,
            connections: blueprint.connections,
            groups: blueprint.groups,
          },
          rev: blueprint.rev ?? 0,
        }
      } catch (e) {
        const ax = e as AxiosError<BlueprintErrorBody>
        if (ax.response?.status === 404) return null
        throw e
      }
    },
    /**
     * 保存画布数据到蓝图文件（CAS）；配置了 `options.assetProject` 时一并写入资产项目。
     *
     * @param canvas 画布数据（只取 nodes/connections/groups）
     * @param opts 版本选项（expectedRev / force）
     * @returns 保存后的版本号
     */
    async save(
      canvas: { nodes: CanvasBlueprint['nodes']; connections: CanvasBlueprint['connections']; groups: CanvasBlueprint['groups'] },
      opts: { expectedRev: number; force?: boolean },
    ): Promise<{ rev: number }> {
      const patch: {
        nodes: CanvasBlueprint['nodes']
        connections: CanvasBlueprint['connections']
        groups: CanvasBlueprint['groups']
        assetProject?: string | null
      } = {
        nodes: canvas.nodes,
        connections: canvas.connections,
        groups: canvas.groups,
      }
      // 资产项目与内容同一请求落盘（服务端项目级蓝图会强制覆盖为所属项目）
      if (options.assetProject) patch.assetProject = options.assetProject()
      const blueprint = await updateBlueprint(ref, id, patch, opts)
      return { rev: blueprint.rev ?? 0 }
    },
  }
}

/** 蓝图持久化适配器类型（useCanvasStore 注入用） */
export type BlueprintCanvasPersistence = ReturnType<typeof blueprintCanvasPersistence>
