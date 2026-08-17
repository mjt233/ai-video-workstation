import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { getProvider } from './registry.js';
import type { ProviderConfigField, ProviderInstance, ResolvedProviderConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 配置文件路径：server/config/providers.json */
export const CONFIG_PATH = path.resolve(__dirname, '../../config/providers.json');

/** 敏感字段占位符（GET 脱敏返回，前端显示「已设置」） */
export const MASKED_SECRET = '__set__';

/** providers.json 文件结构：实例数组 */
interface ProvidersFile {
  instances: ProviderInstance[];
}

/** 判断是否为旧格式（按 provider 类型一份配置） */
function isLegacyFormat(parsed: unknown): parsed is Record<string, Record<string, string | number | boolean>> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  return !('instances' in (parsed as object));
}

async function readConfigFile(configPath: string): Promise<ProvidersFile> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { instances: [] };
    throw e;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`配置文件解析失败（应为 JSON 对象）: ${configPath}`);
  }
  if (isLegacyFormat(parsed)) {
    // 旧格式：先迁移再返回（幂等）
    await migrateLegacyConfig(configPath);
    return readConfigFile(configPath);
  }
  const file = parsed as ProvidersFile;
  if (!Array.isArray(file.instances)) throw new Error(`配置文件缺少 instances 数组: ${configPath}`);
  return file;
}

async function writeConfigFile(configPath: string, file: ProvidersFile): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(file, null, 2), 'utf-8');
  await fs.rename(tmp, configPath);
}

/** 取字段的环境变量兜底值 */
function envValue(field: ProviderConfigField): string | undefined {
  if (!field.envVar) return undefined;
  const v = process.env[field.envVar];
  return v !== undefined ? v : undefined;
}

/** 合并配置：文件值 > 环境变量 > 默认值 */
export function resolveProviderConfig(
  schema: ProviderConfigField[],
  fileValues: Record<string, string | number | boolean> | undefined,
): ResolvedProviderConfig {
  const out: ResolvedProviderConfig = {};
  for (const field of schema) {
    const fileVal = fileValues?.[field.key];
    const envVal = envValue(field);
    const val = fileVal ?? envVal ?? field.defaultValue;
    if (val === undefined) continue;
    out[field.key] = val;
  }
  return out;
}

/** 解析实例配置（文件值 > 环境变量 > 默认值） */
export function resolveInstanceConfig(instance: ProviderInstance): ResolvedProviderConfig {
  const provider = getProvider(instance.type);
  if (!provider) throw new Error(`Provider 未注册: ${instance.type}`);
  return resolveProviderConfig(provider.configSchema, instance.config);
}

/** 实例配置脱敏：secret 字段有值则置空串（不回显真实值） */
export function getInstanceConfigMasked(instance: ProviderInstance): ResolvedProviderConfig {
  const provider = getProvider(instance.type);
  if (!provider) throw new Error(`Provider 未注册: ${instance.type}`);
  const out: ResolvedProviderConfig = {};
  for (const field of provider.configSchema) {
    const val = instance.config[field.key];
    if (val === undefined) continue;
    out[field.key] = field.secret ? '' : val;
  }
  return out;
}

/** 校验并规范化配置值（类型强转 + secret 空串保留原值 + 必填校验） */
function normalizeConfig(
  providerId: string,
  values: Record<string, unknown>,
  current: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Provider 未注册: ${providerId}`);
  const out: Record<string, string | number | boolean> = { ...current };
  for (const field of provider.configSchema) {
    const raw = values[field.key];
    if (raw === undefined) continue;
    if (field.secret && (raw === '' || raw === MASKED_SECRET)) continue; // 保留原值
    if (raw === '') { delete out[field.key]; continue; }
    let parsed: string | number | boolean = String(raw);
    if (field.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`字段 ${field.label} 需要数字，收到: ${String(raw)}`);
      parsed = n;
    } else if (field.type === 'boolean') {
      parsed = raw === true || raw === 'true';
    }
    out[field.key] = parsed;
  }
  for (const field of provider.configSchema) {
    if (!field.required) continue;
    const has = out[field.key] !== undefined || envValue(field) !== undefined || field.defaultValue !== undefined;
    if (!has) throw new Error(`字段 ${field.label} 为必填项`);
  }
  return out;
}

/** 列出全部实例 */
export async function listInstances(configPath: string = CONFIG_PATH): Promise<ProviderInstance[]> {
  const file = await readConfigFile(configPath);
  return file.instances;
}

/** 按 id 获取实例 */
export async function getInstance(id: string, configPath: string = CONFIG_PATH): Promise<ProviderInstance | undefined> {
  const file = await readConfigFile(configPath);
  return file.instances.find((i) => i.id === id);
}

/** 创建实例（生成 uuid；enabledWorkflows 缺省为空数组，由调用方按「默认全选」填充） */
export async function createInstance(
  input: { type: string; name: string; config: Record<string, unknown>; enabledWorkflows?: string[] },
  configPath: string = CONFIG_PATH,
): Promise<ProviderInstance> {
  const provider = getProvider(input.type);
  if (!provider) throw new Error(`Provider 未注册: ${input.type}`);
  if (!input.name || !input.name.trim()) throw new Error('实例名称不能为空');
  const file = await readConfigFile(configPath);
  const instance: ProviderInstance = {
    id: randomUUID(),
    type: input.type,
    name: input.name.trim(),
    config: normalizeConfig(input.type, input.config, {}),
    enabledWorkflows: input.enabledWorkflows ?? [],
  };
  file.instances.push(instance);
  await writeConfigFile(configPath, file);
  return instance;
}

/** 更新实例（secret 空串 = 保留原值；name/config/enabledWorkflows 均可部分更新） */
export async function updateInstance(
  id: string,
  input: { name?: string; config?: Record<string, unknown>; enabledWorkflows?: string[] },
  configPath: string = CONFIG_PATH,
): Promise<ProviderInstance> {
  const file = await readConfigFile(configPath);
  const idx = file.instances.findIndex((i) => i.id === id);
  if (idx < 0) throw new Error(`实例不存在: ${id}`);
  const inst = file.instances[idx];
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error('实例名称不能为空');
    inst.name = input.name.trim();
  }
  if (input.config !== undefined) {
    inst.config = normalizeConfig(inst.type, input.config, inst.config);
  }
  if (input.enabledWorkflows !== undefined) {
    inst.enabledWorkflows = input.enabledWorkflows;
  }
  file.instances[idx] = inst;
  await writeConfigFile(configPath, file);
  return inst;
}

/** 删除实例 */
export async function deleteInstance(id: string, configPath: string = CONFIG_PATH): Promise<void> {
  const file = await readConfigFile(configPath);
  const next = file.instances.filter((i) => i.id !== id);
  if (next.length === file.instances.length) throw new Error(`实例不存在: ${id}`);
  file.instances = next;
  await writeConfigFile(configPath, file);
}

/** 迁移旧格式（按类型一份配置）为实例数组；已是新格式返回 false */
export async function migrateLegacyConfig(configPath: string = CONFIG_PATH): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  if ('instances' in (parsed as object)) return false; // 已是新格式
  const legacy = parsed as Record<string, Record<string, string | number | boolean>>;
  const instances: ProviderInstance[] = [];
  for (const [type, config] of Object.entries(legacy)) {
    const provider = getProvider(type);
    if (!provider) continue; // 未知类型跳过
    instances.push({
      id: randomUUID(),
      type,
      name: `${provider.name}-默认`,
      config,
      enabledWorkflows: [], // 默认全选由同步器按当前列表填充
    });
  }
  await writeConfigFile(configPath, { instances });
  return true;
}
