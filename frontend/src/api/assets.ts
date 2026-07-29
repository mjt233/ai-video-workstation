import client from './client'
import type { AxiosError } from 'axios'

export interface AssetRef {
  episode: string
  shot: string
  file: string
  detail?: string
}

export interface RenamePair {
  from: string
  to: string
}

export class AssetApiError extends Error {
  code?: string
  refs?: AssetRef[]
  constructor(message: string, code?: string, refs?: AssetRef[]) {
    super(message)
    this.code = code
    this.refs = refs
  }
}

function rethrow(err: unknown): never {
  const ax = err as AxiosError<{ error?: string; code?: string; refs?: AssetRef[] }>
  const data = ax.response?.data
  if (data?.error) {
    throw new AssetApiError(data.error, data.code, data.refs)
  }
  throw err
}

export async function createCharacter(
  project: string,
  body: { name: string; gender?: string; age?: string; personality?: string },
) {
  try {
    const { data } = await client.post(`/assets/${project}/character`, body)
    return data as { success: boolean; path: string }
  } catch (e) { rethrow(e) }
}

export async function createStage(project: string, body: { name: string }) {
  try {
    const { data } = await client.post(`/assets/${project}/stage`, body)
    return data as { success: boolean; path: string }
  } catch (e) { rethrow(e) }
}

export async function createSubscene(
  project: string,
  body: { stage: string; label: string; time?: string; angle?: string; weather?: string; description?: string },
) {
  try {
    const { data } = await client.post(`/assets/${project}/subscene`, body)
    return data as { success: boolean; path: string }
  } catch (e) { rethrow(e) }
}

export async function createEpisode(project: string, body: { episode?: string } = {}) {
  try {
    const { data } = await client.post(`/assets/${project}/episode`, body)
    return data as { success: boolean; path: string; episode: string }
  } catch (e) { rethrow(e) }
}

export async function createShot(
  project: string,
  body: { episode: string; shot?: string; position?: 'insert' | 'end' },
) {
  try {
    const { data } = await client.post(`/assets/${project}/shot`, body)
    return data as { success: boolean; path: string; episode: string; shot: string; renames: RenamePair[] }
  } catch (e) { rethrow(e) }
}

export async function deleteCharacter(project: string, name: string) {
  try {
    const { data } = await client.delete(`/assets/${project}/character/${encodeURIComponent(name)}`)
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

export async function deleteStage(project: string, name: string) {
  try {
    const { data } = await client.delete(`/assets/${project}/stage/${encodeURIComponent(name)}`)
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

export async function deleteSubscene(project: string, stage: string, label: string) {
  try {
    const { data } = await client.delete(
      `/assets/${project}/subscene/${encodeURIComponent(stage)}/${encodeURIComponent(label)}`,
    )
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

export async function deleteEpisode(project: string, episode: string) {
  try {
    const { data } = await client.delete(`/assets/${project}/episode/${encodeURIComponent(episode)}`)
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

export async function deleteShot(project: string, episode: string, shot: string) {
  try {
    const { data } = await client.delete(
      `/assets/${project}/shot/${encodeURIComponent(episode)}/${encodeURIComponent(shot)}`,
    )
    return data as { success: boolean; renames: RenamePair[] }
  } catch (e) { rethrow(e) }
}

export async function reorderSceneStage(
  project: string,
  episode: string,
  shot: string,
  from: number,
  to: number,
) {
  try {
    const { data } = await client.post(
      `/assets/${project}/scene/${encodeURIComponent(episode)}/${encodeURIComponent(shot)}/stage/reorder`,
      { from, to },
    )
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

export interface StageFrameBody {
  基础场景: string
  登场角色?: string[]
  prompt?: string
  index?: number
}

export async function createSceneStageFrame(
  project: string,
  episode: string,
  shot: string,
  body: StageFrameBody,
) {
  try {
    const { data } = await client.post(
      `/assets/${project}/scene/${encodeURIComponent(episode)}/${encodeURIComponent(shot)}/stage`,
      body,
    )
    return data as { success: boolean; index: number }
  } catch (e) { rethrow(e) }
}

export async function updateSceneStageFrame(
  project: string,
  episode: string,
  shot: string,
  index: number,
  body: StageFrameBody,
) {
  try {
    const { data } = await client.put(
      `/assets/${project}/scene/${encodeURIComponent(episode)}/${encodeURIComponent(shot)}/stage/${index}`,
      body,
    )
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

export async function deleteSceneStageFrame(
  project: string,
  episode: string,
  shot: string,
  index: number,
) {
  try {
    const { data } = await client.delete(
      `/assets/${project}/scene/${encodeURIComponent(episode)}/${encodeURIComponent(shot)}/stage/${index}`,
    )
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

export interface HistoryVersion {
  name: string
  path: string
  mtime: string
  size: number
}

export async function listAssetHistory(project: string, assetPath: string) {
  try {
    const { data } = await client.get(`/assets/${project}/history`, {
      params: { path: assetPath },
    })
    return data as { versions: HistoryVersion[] }
  } catch (e) { rethrow(e) }
}

export async function activateAssetHistory(
  project: string,
  assetPath: string,
  versionPath: string,
) {
  try {
    const { data } = await client.post(`/assets/${project}/history/activate`, {
      path: assetPath,
      versionPath,
    })
    return data as { success: boolean; archived: string | null; current: string }
  } catch (e) { rethrow(e) }
}

export async function deleteAssetHistory(
  project: string,
  assetPath: string,
  versionPath: string,
) {
  try {
    const { data } = await client.delete(`/assets/${project}/history`, {
      data: {
        path: assetPath,
        versionPath,
      },
    })
    return data as { success: boolean; deleted: string }
  } catch (e) { rethrow(e) }
}

/**
 * 上传图片资产到指定 assert 路径。
 * 服务端会先归档已有当前资产，再写入新文件。
 */
export async function uploadAssetImage(
  project: string,
  assetPath: string,
  file: File,
) {
  try {
    const form = new FormData()
    form.append('path', assetPath)
    form.append('file', file)
    const { data } = await client.post(`/assets/${project}/upload`, form)
    return data as { success: boolean; path: string; archived: string | null }
  } catch (e) { rethrow(e) }
}


// ── 衍生变体 ────────────────────────────────────────────────────────

export interface VariantInfo {
  id: string
  desc: string
  baseImage?: string
  createdAt?: string
  updatedAt?: string
  kind: 'character' | 'stage'
  owner: string
  baseLabel?: string
  metaPath: string
  imagePath: string
  hasImage: boolean
  ref: string
}

export async function listCharacterVariants(project: string, name: string) {
  try {
    const { data } = await client.get(`/assets/${project}/character/${encodeURIComponent(name)}/variants`)
    return data as { variants: VariantInfo[] }
  } catch (e) { rethrow(e) }
}

export async function createCharacterVariant(
  project: string,
  name: string,
  body: { id: string; desc: string },
) {
  try {
    const { data } = await client.post(
      `/assets/${project}/character/${encodeURIComponent(name)}/variants`,
      body,
    )
    return data as { success: boolean; variant: VariantInfo }
  } catch (e) { rethrow(e) }
}

export async function updateCharacterVariant(
  project: string,
  name: string,
  variantId: string,
  body: { desc?: string },
) {
  try {
    const { data } = await client.put(
      `/assets/${project}/character/${encodeURIComponent(name)}/variants/${encodeURIComponent(variantId)}`,
      body,
    )
    return data as { success: boolean; variant: VariantInfo }
  } catch (e) { rethrow(e) }
}

export async function deleteCharacterVariant(
  project: string,
  name: string,
  variantId: string,
) {
  try {
    const { data } = await client.delete(
      `/assets/${project}/character/${encodeURIComponent(name)}/variants/${encodeURIComponent(variantId)}`,
    )
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

export async function listStageVariants(project: string, stage: string, label: string) {
  try {
    const { data } = await client.get(
      `/assets/${project}/stage/${encodeURIComponent(stage)}/${encodeURIComponent(label)}/variants`,
    )
    return data as { variants: VariantInfo[] }
  } catch (e) { rethrow(e) }
}

export async function createStageVariant(
  project: string,
  stage: string,
  label: string,
  body: { id: string; desc: string },
) {
  try {
    const { data } = await client.post(
      `/assets/${project}/stage/${encodeURIComponent(stage)}/${encodeURIComponent(label)}/variants`,
      body,
    )
    return data as { success: boolean; variant: VariantInfo }
  } catch (e) { rethrow(e) }
}

export async function updateStageVariant(
  project: string,
  stage: string,
  label: string,
  variantId: string,
  body: { desc?: string },
) {
  try {
    const { data } = await client.put(
      `/assets/${project}/stage/${encodeURIComponent(stage)}/${encodeURIComponent(label)}/variants/${encodeURIComponent(variantId)}`,
      body,
    )
    return data as { success: boolean; variant: VariantInfo }
  } catch (e) { rethrow(e) }
}

export async function deleteStageVariant(
  project: string,
  stage: string,
  label: string,
  variantId: string,
) {
  try {
    const { data } = await client.delete(
      `/assets/${project}/stage/${encodeURIComponent(stage)}/${encodeURIComponent(label)}/variants/${encodeURIComponent(variantId)}`,
    )
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}
