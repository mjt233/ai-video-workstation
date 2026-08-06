import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getProvider } from './registry.js';
import type { ProviderConfigField, ResolvedProviderConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 配置文件路径：server/config/providers.json */
export const CONFIG_PATH = path.resolve(__dirname, '../../config/providers.json');

/** 敏感字段占位符（GET 脱敏返回，前端显示「已设置」） */
export const MASKED_SECRET = '__set__';

/** providers.json 文件结构：provider id → 配置键值 */
interface ProvidersFile {
  [providerId: string]: Record<string, string | number | boolean>;
}

/**
 * 读取配置文件。
 * - 文件不存在（ENOENT）：返回空对象（首次保存时正常创建）；
 * - 存在但解析失败：抛错（避免 setProviderConfig 以空对象为基础覆盖损坏文件、抹掉其它配置）。
 * @param configPath 配置文件路径（测试可注入临时路径）
 */
async function readConfigFile(configPath: string): Promise<ProvidersFile> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw e;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`配置文件解析失败（应为 JSON 对象）: ${configPath}`);
  }
  return parsed as ProvidersFile;
}

/** 取字段的环境变量兜底值 */
function envValue(field: ProviderConfigField): string | undefined {
  if (!field.envVar) return undefined;
  const v = process.env[field.envVar];
  return v !== undefined ? v : undefined;
}

/**
 * 合并配置：文件值 > 环境变量 > 默认值。
 * @param schema provider 配置字段声明
 * @param fileValues 文件中的配置值（可为 undefined）
 * @returns 合并后的已解析配置
 */
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

/**
 * 读取 provider 的已解析配置（供引擎 createClient 使用）。
 * @param providerId provider id
 * @param configPath 配置文件路径（默认 CONFIG_PATH；测试可注入）
 */
export async function getProviderConfig(
  providerId: string,
  configPath: string = CONFIG_PATH,
): Promise<ResolvedProviderConfig> {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Provider 未注册: ${providerId}`);
  const file = await readConfigFile(configPath);
  return resolveProviderConfig(provider.configSchema, file[providerId]);
}

/**
 * 读取 provider 配置用于前端展示：secret 字段有值则脱敏为 MASKED_SECRET；
 * 未在文件中配置的字段不返回（前端回退到 defaultValue 展示）。
 * @param providerId provider id
 * @param configPath 配置文件路径（默认 CONFIG_PATH；测试可注入）
 */
export async function getProviderConfigMasked(
  providerId: string,
  configPath: string = CONFIG_PATH,
): Promise<ResolvedProviderConfig> {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Provider 未注册: ${providerId}`);
  const file = await readConfigFile(configPath);
  const fileValues = file[providerId] ?? {};
  const out: ResolvedProviderConfig = {};
  for (const field of provider.configSchema) {
    const val = fileValues[field.key];
    if (val === undefined) continue;
    out[field.key] = field.secret ? MASKED_SECRET : val;
  }
  return out;
}

/**
 * 校验并保存 provider 配置。
 * - 未知键忽略；类型强转（number/boolean）；
 * - secret 字段传空串 = 保留原值；非 secret 空串 = 删除该键；
 * - 必填字段在文件值 + 环境变量 + 默认值均缺失时报错；
 * - 原子写入（临时文件 + rename）。
 * @param providerId provider id
 * @param values 要保存的配置键值（只处理 configSchema 中声明的键）
 * @param configPath 配置文件路径（默认 CONFIG_PATH；测试可注入）
 */
export async function setProviderConfig(
  providerId: string,
  values: Record<string, unknown>,
  configPath: string = CONFIG_PATH,
): Promise<void> {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Provider 未注册: ${providerId}`);

  const file = await readConfigFile(configPath);
  const current: Record<string, string | number | boolean> = { ...(file[providerId] ?? {}) };

  for (const field of provider.configSchema) {
    const raw = values[field.key];
    if (raw === undefined) continue;
    // secret 空串 / MASKED_SECRET 占位符 = 保留原值（防止前端把脱敏占位符回写覆盖真实密钥）
    if (field.secret && (raw === '' || raw === MASKED_SECRET)) continue;
    if (raw === '') {
      delete current[field.key];
      continue;
    }
    let parsed: string | number | boolean = String(raw);
    if (field.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new Error(`字段 ${field.label} 需要数字，收到: ${String(raw)}`);
      }
      parsed = n;
    } else if (field.type === 'boolean') {
      parsed = raw === true || raw === 'true';
    }
    current[field.key] = parsed;
  }

  // 必填校验
  for (const field of provider.configSchema) {
    if (!field.required) continue;
    const has = current[field.key] !== undefined || envValue(field) !== undefined || field.defaultValue !== undefined;
    if (!has) {
      throw new Error(`字段 ${field.label} 为必填项`);
    }
  }

  file[providerId] = current;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(file, null, 2), 'utf-8');
  await fs.rename(tmp, configPath);
}
