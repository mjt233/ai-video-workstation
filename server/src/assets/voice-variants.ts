/**
 * 角色声音变体（voice variant）资产读写。
 *
 * 声音变体是角色音色设计的衍生变体：在角色原始声线描述（voice.md）基础上
 * 追加或覆盖提示词，并指定朗读台词，用于生成不同语气/情绪的试听音频。
 * 仅支持单层结构（无父/子层级）。
 *
 * 目录约定（不出现在资产浏览器树中）：
 * - prompt/character/{name}/voice-variants/{variantId}.json
 * - assert/character/{name}/voice-variants/{variantId}.{flac|mp3|wav|ogg|m4a|aac}
 *   —— 生成产物固定为 .flac（outputPath）；手动上传**保留原格式**，
 *   实际存在的当前音频由 audioPath 给出（候选顺序见 VOICE_AUDIO_EXTS）。
 *
 * meta JSON：
 * {
 *   "id": "哭腔",
 *   "prompt": "带哭腔、语速稍慢",
 *   "promptMode": "append",        // append=追加到 voice.md，overwrite=覆盖 voice.md
 *   "台词": "我好难过……",
 *   "createdAt": "ISO",
 *   "updatedAt": "ISO"
 * }
 */

import fs from 'fs/promises';
import path from 'path';
import {
  assertSafeName,
  ensureDir,
  pathExists,
  resolveProjectPath,
} from './paths.js';
import { VOICE_AUDIO_EXTS } from './history.js';

/** 提示词模式：append=在角色音色原描述后追加；overwrite=完全覆盖原描述 */
export type VoicePromptMode = 'append' | 'overwrite';

export interface VoiceVariantMeta {
  id: string;
  /** 变体提示词（音色风格/语气描述） */
  prompt: string;
  /** 提示词模式，默认 append */
  promptMode: VoicePromptMode;
  /** 台词：变体朗读的文本 */
  台词: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface VoiceVariantInfo extends VoiceVariantMeta {
  kind: 'character';
  /** 角色名 */
  owner: string;
  /** prompt meta 相对路径 */
  metaPath: string;
  /** 实际存在的当前音频相对路径（未上传/未生成时为 null） */
  audioPath: string | null;
  /** 生成输出路径（规范 .flac；「重新生成」目标固定） */
  outputPath: string;
  /** 是否已有当前音频 */
  hasAudio: boolean;
}

function voiceMetaRel(name: string, variantId: string): string {
  return `prompt/character/${name}/voice-variants/${variantId}.json`;
}

/** 生成输出路径（规范 .flac） */
function voiceAudioRel(name: string, variantId: string): string {
  return `assert/character/${name}/voice-variants/${variantId}.flac`;
}

/**
 * 解析变体实际存在的当前音频路径（按候选扩展名顺序，flac 为生成产物默认优先）。
 *
 * @param project 项目名
 * @param name 角色名
 * @param variantId 变体名称
 * @returns 实际存在的音频相对路径；不存在时为 null
 */
export async function resolveVoiceVariantAudio(
  project: string,
  name: string,
  variantId: string,
): Promise<string | null> {
  for (const ext of VOICE_AUDIO_EXTS) {
    const rel = `assert/character/${name}/voice-variants/${variantId}.${ext}`;
    if (await pathExists(resolveProjectPath(project, rel))) return rel;
  }
  return null;
}

/**
 * 解析角色基础声音实际存在的当前音频路径（voice.{ext}）。
 *
 * @param project 项目名
 * @param name 角色名
 * @returns 实际存在的音频相对路径；不存在时为 null
 */
export async function resolveCharacterVoiceAudio(
  project: string,
  name: string,
): Promise<string | null> {
  assertSafeName(name, '角色名');
  for (const ext of VOICE_AUDIO_EXTS) {
    const rel = `assert/character/${name}/voice.${ext}`;
    if (await pathExists(resolveProjectPath(project, rel))) return rel;
  }
  return null;
}

async function readMeta(project: string, metaRel: string): Promise<VoiceVariantMeta | null> {
  try {
    const full = resolveProjectPath(project, metaRel);
    const raw = await fs.readFile(full, 'utf-8');
    const data = JSON.parse(raw) as Partial<VoiceVariantMeta>;
    if (!data || typeof data !== 'object') return null;
    const id = String(data.id ?? path.basename(metaRel, '.json')).trim();
    const prompt = String(data.prompt ?? '').trim();
    const promptMode = data.promptMode === 'overwrite' ? 'overwrite' : 'append';
    return {
      id,
      prompt,
      promptMode,
      台词: String(data.台词 ?? '').trim(),
      createdAt: data.createdAt ? String(data.createdAt) : undefined,
      updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
    };
  } catch {
    // 声线变体元数据缺失/损坏时视为不存在
    return null;
  }
}

async function writeMeta(project: string, metaRel: string, meta: VoiceVariantMeta): Promise<void> {
  const full = resolveProjectPath(project, metaRel);
  await ensureDir(path.dirname(full));
  await fs.writeFile(full, `${JSON.stringify(meta, null, 2)}\n`, 'utf-8');
}

/** 解析提示词模式，非法值回退为默认 append */
function normalizePromptMode(mode: unknown): VoicePromptMode {
  return mode === 'overwrite' ? 'overwrite' : 'append';
}

/**
 * 列出角色的声音变体（按名称排序）。
 *
 * @param project 项目名
 * @param name 角色名
 * @returns 声音变体信息数组（audioPath = 实际存在的当前音频，可空；outputPath = 规范 .flac）
 */
export async function listCharacterVoiceVariants(
  project: string,
  name: string,
): Promise<VoiceVariantInfo[]> {
  assertSafeName(name, '角色名');
  const dirRel = `prompt/character/${name}/voice-variants`;
  const dir = resolveProjectPath(project, dirRel);
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    // 声线变体目录不存在时返回空数组
    return [];
  }
  const result: VoiceVariantInfo[] = [];
  for (const f of files) {
    const variantId = f.slice(0, -'.json'.length);
    const metaPath = voiceMetaRel(name, variantId);
    const meta = await readMeta(project, metaPath);
    if (!meta) continue;
    const audioPath = await resolveVoiceVariantAudio(project, name, variantId);
    result.push({
      ...meta,
      id: meta.id || variantId,
      kind: 'character',
      owner: name,
      metaPath,
      audioPath,
      outputPath: voiceAudioRel(name, variantId),
      hasAudio: audioPath !== null,
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id, 'zh'));
}

/**
 * 创建角色声音变体。
 *
 * @param project 项目名
 * @param name 角色名
 * @param body 变体参数（id/prompt/promptMode/台词）
 * @returns 新建的声音变体信息
 */
export async function createCharacterVoiceVariant(
  project: string,
  name: string,
  body: { id: string; prompt: string; promptMode?: VoicePromptMode; 台词: string },
): Promise<VoiceVariantInfo> {
  assertSafeName(name, '角色名');
  const id = (body.id ?? '').trim();
  assertSafeName(id, '变体名称');
  const prompt = (body.prompt ?? '').trim();
  if (!prompt) {
    throw Object.assign(new Error('提示词必填'), { code: 'INVALID' });
  }
  const line = (body.台词 ?? '').trim();
  if (!line) {
    throw Object.assign(new Error('台词必填'), { code: 'INVALID' });
  }
  const promptMode = normalizePromptMode(body.promptMode);
  const charDir = resolveProjectPath(project, `prompt/character/${name}`);
  if (!(await pathExists(charDir))) {
    throw Object.assign(new Error('角色不存在'), { code: 'NOT_FOUND' });
  }
  const metaPath = voiceMetaRel(name, id);
  if (await pathExists(resolveProjectPath(project, metaPath))) {
    throw Object.assign(new Error('声音变体已存在'), { code: 'EXISTS' });
  }
  const now = new Date().toISOString();
  const meta: VoiceVariantMeta = {
    id,
    prompt,
    promptMode,
    台词: line,
    createdAt: now,
    updatedAt: now,
  };
  await writeMeta(project, metaPath, meta);
  return {
    ...meta,
    kind: 'character',
    owner: name,
    metaPath,
    audioPath: null,
    outputPath: voiceAudioRel(name, id),
    hasAudio: false,
  };
}

/**
 * 更新角色声音变体（提示词/模式/台词）。
 *
 * @param project 项目名
 * @param name 角色名
 * @param variantId 变体名称
 * @param body 可更新的字段（prompt/promptMode/台词）
 * @returns 更新后的声音变体信息
 */
export async function updateCharacterVoiceVariant(
  project: string,
  name: string,
  variantId: string,
  body: { prompt?: string; promptMode?: VoicePromptMode; 台词?: string },
): Promise<VoiceVariantInfo> {
  assertSafeName(name, '角色名');
  assertSafeName(variantId, '变体名称');
  const metaPath = voiceMetaRel(name, variantId);
  const existing = await readMeta(project, metaPath);
  if (!existing) {
    throw Object.assign(new Error('声音变体不存在'), { code: 'NOT_FOUND' });
  }
  if (body.prompt !== undefined) {
    const prompt = body.prompt.trim();
    if (!prompt) throw Object.assign(new Error('提示词不能为空'), { code: 'INVALID' });
    existing.prompt = prompt;
  }
  if (body.promptMode !== undefined) {
    existing.promptMode = normalizePromptMode(body.promptMode);
  }
  if (body.台词 !== undefined) {
    const line = body.台词.trim();
    if (!line) throw Object.assign(new Error('台词不能为空'), { code: 'INVALID' });
    existing.台词 = line;
  }
  existing.updatedAt = new Date().toISOString();
  await writeMeta(project, metaPath, existing);
  const audioPath = await resolveVoiceVariantAudio(project, name, variantId);
  return {
    ...existing,
    kind: 'character',
    owner: name,
    metaPath,
    audioPath,
    outputPath: voiceAudioRel(name, variantId),
    hasAudio: audioPath !== null,
  };
}

/**
 * 重命名角色声音变体（同步重命名已生成的音频文件）。
 *
 * @param project 项目名
 * @param name 角色名
 * @param oldId 原变体名称
 * @param newId 新变体名称
 * @returns 重命名后的声音变体信息
 */
export async function renameCharacterVoiceVariant(
  project: string,
  name: string,
  oldId: string,
  newId: string,
): Promise<VoiceVariantInfo> {
  assertSafeName(name, '角色名');
  assertSafeName(oldId, '变体名称');
  assertSafeName(newId, '变体名称');
  if (oldId === newId) {
    const list = await listCharacterVoiceVariants(project, name);
    const found = list.find((v) => v.id === oldId);
    if (!found) throw Object.assign(new Error('声音变体不存在'), { code: 'NOT_FOUND' });
    return found;
  }
  const oldMetaPath = voiceMetaRel(name, oldId);
  const newMetaPath = voiceMetaRel(name, newId);
  if (!(await pathExists(resolveProjectPath(project, oldMetaPath)))) {
    throw Object.assign(new Error('声音变体不存在'), { code: 'NOT_FOUND' });
  }
  if (await pathExists(resolveProjectPath(project, newMetaPath))) {
    throw Object.assign(new Error('目标名称已存在'), { code: 'EXISTS' });
  }
  const meta = await readMeta(project, oldMetaPath);
  if (!meta) throw Object.assign(new Error('meta 读取失败'), { code: 'INTERNAL' });
  meta.id = newId;
  meta.updatedAt = new Date().toISOString();
  await writeMeta(project, newMetaPath, meta);
  await fs.unlink(resolveProjectPath(project, oldMetaPath));
  // 同步重命名音频文件（保留原扩展名：上传可能为 mp3/wav 等；生成产物为 flac）
  await ensureDir(resolveProjectPath(project, `assert/character/${name}/voice-variants`));
  for (const ext of VOICE_AUDIO_EXTS) {
    const oldAudioFull = resolveProjectPath(project, `assert/character/${name}/voice-variants/${oldId}.${ext}`);
    if (!(await pathExists(oldAudioFull))) continue;
    const newAudioFull = resolveProjectPath(project, `assert/character/${name}/voice-variants/${newId}.${ext}`);
    if (await pathExists(newAudioFull)) {
      throw Object.assign(new Error('目标音频已存在'), { code: 'EXISTS' });
    }
    await fs.rename(oldAudioFull, newAudioFull);
  }
  // 清理旧 history 目录（若有）
  const oldHistDir = resolveProjectPath(project, `assert/character/${name}/voice-variants/history/${oldId}`);
  if (await pathExists(oldHistDir)) {
    await fs.rm(oldHistDir, { recursive: true, force: true });
  }
  const audioPath = await resolveVoiceVariantAudio(project, name, newId);
  return {
    ...meta,
    kind: 'character',
    owner: name,
    metaPath: newMetaPath,
    audioPath,
    outputPath: voiceAudioRel(name, newId),
    hasAudio: audioPath !== null,
  };
}

/**
 * 删除角色声音变体（连同已生成的音频与历史版本）。
 *
 * @param project 项目名
 * @param name 角色名
 * @param variantId 变体名称
 */
export async function deleteCharacterVoiceVariant(
  project: string,
  name: string,
  variantId: string,
): Promise<void> {
  assertSafeName(name, '角色名');
  assertSafeName(variantId, '变体名称');
  const metaPath = voiceMetaRel(name, variantId);
  const metaFull = resolveProjectPath(project, metaPath);
  if (!(await pathExists(metaFull))) {
    throw Object.assign(new Error('声音变体不存在'), { code: 'NOT_FOUND' });
  }
  await fs.unlink(metaFull);
  // 移除所有扩展名的当前音频（上传保留原格式 + 生成 flac 可能并存）
  for (const ext of VOICE_AUDIO_EXTS) {
    const audioFull = resolveProjectPath(project, `assert/character/${name}/voice-variants/${variantId}.${ext}`);
    if (await pathExists(audioFull)) {
      await fs.unlink(audioFull);
    }
  }
  const histDir = resolveProjectPath(project, `assert/character/${name}/voice-variants/history/${variantId}`);
  if (await pathExists(histDir)) {
    await fs.rm(histDir, { recursive: true, force: true });
  }
}
