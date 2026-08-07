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

export async function mergeSceneAudio(
  project: string,
  episode: string,
  shot: string,
) {
  try {
    const { data } = await client.post(
      `/assets/${project}/scene/${encodeURIComponent(episode)}/${encodeURIComponent(shot)}/audio/merge`,
    )
    return data as { success: boolean; path: string }
  } catch (e) { rethrow(e) }
}

/**
 * 删除分镜已合并的音频（merged.flac）。
 *
 * 分镜台词发生新增/修改/删除/排序后，已合并音频与最新台词不再匹配，
 * 调用本接口使其失效（文件不存在时也返回成功，幂等）。
 *
 * @param project 项目名
 * @param episode 集数
 * @param shot 分镜号
 * @returns 请求结果
 */
export async function deleteSceneMergedAudio(
  project: string,
  episode: string,
  shot: string,
) {
  try {
    const { data } = await client.delete(
      `/assets/${project}/scene/${encodeURIComponent(episode)}/${encodeURIComponent(shot)}/audio/merged`,
    )
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

export async function reorderSceneScript(
  project: string,
  episode: string,
  shot: string,
  from: number,
  to: number,
) {
  try {
    const { data } = await client.post(
      `/assets/${project}/scene/${encodeURIComponent(episode)}/${encodeURIComponent(shot)}/script/reorder`,
      { from, to },
    )
    return data as { success: boolean }
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
  /** 是否禁用该场景帧：true 时视频生成（image-to-video）跳过此帧 */
  disabled?: boolean
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

export async function updateSceneScriptEntry(
  project: string,
  episode: string,
  shot: string,
  index: number,
  body: { 角色名: string; 台词: string; 情绪: string },
) {
  try {
    const { data } = await client.put(
      `/assets/${project}/scene/${encodeURIComponent(episode)}/${encodeURIComponent(shot)}/script/${index}`,
      body,
    )
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

export async function deleteSceneScriptEntry(
  project: string,
  episode: string,
  shot: string,
  index: number,
) {
  try {
    const { data } = await client.delete(
      `/assets/${project}/scene/${encodeURIComponent(episode)}/${encodeURIComponent(shot)}/script/${index}`,
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
  parentId?: string
  refs: string[]
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
  body: { id: string; desc: string; parentId?: string; refs?: string[] },
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
  body: { desc?: string; parentId?: string; refs?: string[] },
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
  cascade?: boolean,
) {
  try {
    const params = cascade ? '?cascade=true' : ''
    const { data } = await client.delete(
      `/assets/${project}/character/${encodeURIComponent(name)}/variants/${encodeURIComponent(variantId)}${params}`,
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
  body: { id: string; desc: string; parentId?: string; refs?: string[] },
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
  body: { desc?: string; parentId?: string; refs?: string[] },
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
  cascade?: boolean,
) {
  try {
    const params = cascade ? '?cascade=true' : ''
    const { data } = await client.delete(
      `/assets/${project}/stage/${encodeURIComponent(stage)}/${encodeURIComponent(label)}/variants/${encodeURIComponent(variantId)}${params}`,
    )
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}

export async function renameCharacterVariant(
  project: string,
  name: string,
  variantId: string,
  newId: string,
) {
  try {
    const { data } = await client.put(
      `/assets/${project}/character/${encodeURIComponent(name)}/variants/${encodeURIComponent(variantId)}/rename`,
      { newId },
    )
    return data as { success: boolean; variant: VariantInfo }
  } catch (e) { rethrow(e) }
}

export async function renameStageVariant(
  project: string,
  stage: string,
  label: string,
  variantId: string,
  newId: string,
) {
  try {
    const { data } = await client.put(
      `/assets/${project}/stage/${encodeURIComponent(stage)}/${encodeURIComponent(label)}/variants/${encodeURIComponent(variantId)}/rename`,
      { newId },
    )
    return data as { success: boolean; variant: VariantInfo }
  } catch (e) { rethrow(e) }
}

// ── 角色声音变体（单层结构）──────────────────────────────────────────

/** 提示词模式：append=在角色音色原描述后追加；overwrite=完全覆盖原描述 */
export type VoicePromptMode = 'append' | 'overwrite'

export interface VoiceVariantInfo {
  id: string
  /** 变体提示词（音色风格/语气描述） */
  prompt: string
  /** 提示词模式，默认 append */
  promptMode: VoicePromptMode
  /** 台词：变体朗读的文本 */
  台词: string
  createdAt?: string
  updatedAt?: string
  kind: 'character'
  owner: string
  metaPath: string
  audioPath: string
  hasAudio: boolean
}

export async function listCharacterVoiceVariants(project: string, name: string) {
  try {
    const { data } = await client.get(
      `/assets/${project}/character/${encodeURIComponent(name)}/voice-variants`,
    )
    return data as { variants: VoiceVariantInfo[] }
  } catch (e) { rethrow(e) }
}

export async function createCharacterVoiceVariant(
  project: string,
  name: string,
  body: { id: string; prompt: string; promptMode?: VoicePromptMode; 台词: string },
) {
  try {
    const { data } = await client.post(
      `/assets/${project}/character/${encodeURIComponent(name)}/voice-variants`,
      body,
    )
    return data as { success: boolean; variant: VoiceVariantInfo }
  } catch (e) { rethrow(e) }
}

export async function updateCharacterVoiceVariant(
  project: string,
  name: string,
  variantId: string,
  body: { prompt?: string; promptMode?: VoicePromptMode; 台词?: string },
) {
  try {
    const { data } = await client.put(
      `/assets/${project}/character/${encodeURIComponent(name)}/voice-variants/${encodeURIComponent(variantId)}`,
      body,
    )
    return data as { success: boolean; variant: VoiceVariantInfo }
  } catch (e) { rethrow(e) }
}

export async function renameCharacterVoiceVariant(
  project: string,
  name: string,
  variantId: string,
  newId: string,
) {
  try {
    const { data } = await client.put(
      `/assets/${project}/character/${encodeURIComponent(name)}/voice-variants/${encodeURIComponent(variantId)}/rename`,
      { newId },
    )
    return data as { success: boolean; variant: VoiceVariantInfo }
  } catch (e) { rethrow(e) }
}

export async function deleteCharacterVoiceVariant(
  project: string,
  name: string,
  variantId: string,
) {
  try {
    const { data } = await client.delete(
      `/assets/${project}/character/${encodeURIComponent(name)}/voice-variants/${encodeURIComponent(variantId)}`,
    )
    return data as { success: boolean }
  } catch (e) { rethrow(e) }
}
