/**
 * 预设提示词存储：全局共享的预设提示词列表（系统配置 → 预设提示词）。
 *
 * 数据落盘为 server/config/presets.json（结构与 providers.json 同风格）：
 * ```json
 * { "presets": [{ "id": "uuid", "name": "...", "content": "..." }] }
 * ```
 *
 * 预设提示词不属于任何项目，所有项目的资产画布 AI 文本生成节点均可选择使用。
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 预设提示词配置文件路径：server/config/presets.json */
export const PRESETS_PATH = path.resolve(__dirname, '../../config/presets.json');

/** 预设提示词条目 */
export interface PresetPrompt {
  /** 唯一 id（uuid） */
  id: string;
  /** 预设名称（必填非空） */
  name: string;
  /** 提示词内容（必填非空；可包含 {user_prompt} 占位符） */
  content: string;
}

/** presets.json 文件结构：预设数组 */
interface PresetsFile {
  presets: PresetPrompt[];
}

/**
 * 读取预设配置文件（不存在时返回空列表）。
 *
 * @param configPath 配置文件路径（测试可注入临时路径）
 * @returns 文件结构（presets 数组）
 */
async function readConfigFile(configPath: string): Promise<PresetsFile> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { presets: [] };
    throw e;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`配置文件解析失败（应为 JSON 对象）: ${configPath}`);
  }
  const file = parsed as PresetsFile;
  if (!Array.isArray(file.presets)) throw new Error(`配置文件缺少 presets 数组: ${configPath}`);
  return file;
}

/**
 * 原子写入预设配置文件（先写临时文件再 rename，避免写坏半截）。
 *
 * @param configPath 配置文件路径
 * @param file 文件结构
 */
async function writeConfigFile(configPath: string, file: PresetsFile): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(file, null, 2), 'utf-8');
  await fs.rename(tmp, configPath);
}

/**
 * 校验并规范化预设输入：name 必填非空（trim），content 必填非空（trim 后校验，保留原值）。
 *
 * @param label 字段中文标签（用于报错，如「名称」「提示词内容」）
 * @param value 前端提交的原始值
 * @returns 规范化后的字符串值
 */
function requireNonEmpty(label: string, value: unknown): string {
  if (typeof value !== 'string') throw new Error(`${label}不能为空`);
  if (!value.trim()) throw new Error(`${label}不能为空`);
  return value;
}

/**
 * 列出全部预设提示词。
 *
 * @param configPath 配置文件路径（默认 PRESETS_PATH）
 * @returns 预设列表（按创建顺序）
 */
export async function listPresets(configPath: string = PRESETS_PATH): Promise<PresetPrompt[]> {
  const file = await readConfigFile(configPath);
  return file.presets;
}

/**
 * 按 id 获取预设提示词。
 *
 * @param id 预设 id
 * @param configPath 配置文件路径（默认 PRESETS_PATH）
 * @returns 预设条目或 undefined（不存在时）
 */
export async function getPreset(id: string, configPath: string = PRESETS_PATH): Promise<PresetPrompt | undefined> {
  const file = await readConfigFile(configPath);
  return file.presets.find((p) => p.id === id);
}

/**
 * 创建预设提示词（生成 uuid）。
 *
 * @param input 预设输入（name/content 均必填非空）
 * @param configPath 配置文件路径（默认 PRESETS_PATH）
 * @returns 创建的预设条目
 */
export async function createPreset(
  input: { name: string; content: string },
  configPath: string = PRESETS_PATH,
): Promise<PresetPrompt> {
  const name = requireNonEmpty('名称', input.name).trim();
  const content = requireNonEmpty('提示词内容', input.content);
  const file = await readConfigFile(configPath);
  const preset: PresetPrompt = { id: randomUUID(), name, content };
  file.presets.push(preset);
  await writeConfigFile(configPath, file);
  return preset;
}

/**
 * 更新预设提示词（name/content 均可部分更新；传入字段必填非空）。
 *
 * @param id 预设 id
 * @param input 可部分更新的字段
 * @param configPath 配置文件路径（默认 PRESETS_PATH）
 * @returns 更新后的预设条目（不存在时抛错）
 */
export async function updatePreset(
  id: string,
  input: { name?: string; content?: string },
  configPath: string = PRESETS_PATH,
): Promise<PresetPrompt> {
  const file = await readConfigFile(configPath);
  const idx = file.presets.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error(`预设提示词不存在: ${id}`);
  const preset = file.presets[idx];
  if (input.name !== undefined) {
    preset.name = requireNonEmpty('名称', input.name).trim();
  }
  if (input.content !== undefined) {
    preset.content = requireNonEmpty('提示词内容', input.content);
  }
  file.presets[idx] = preset;
  await writeConfigFile(configPath, file);
  return preset;
}

/**
 * 删除预设提示词（不存在时抛错）。
 *
 * @param id 预设 id
 * @param configPath 配置文件路径（默认 PRESETS_PATH）
 */
export async function deletePreset(id: string, configPath: string = PRESETS_PATH): Promise<void> {
  const file = await readConfigFile(configPath);
  const next = file.presets.filter((p) => p.id !== id);
  if (next.length === file.presets.length) throw new Error(`预设提示词不存在: ${id}`);
  file.presets = next;
  await writeConfigFile(configPath, file);
}
