/**
 * LLM 客户端：按协议构建 Vercel AI SDK 语言模型实例的统一封装。
 *
 * 这是「协议差异 → 统一接口」的收口点：后续新增协议只需在此扩展；
 * 调用方（runtime / routes/llm.ts / 测试连接）依赖 LlmClient 的
 * model() / reasoningOptions() / mediaRule() 与 baseUrl/apiKey。
 */
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createXai } from '@ai-sdk/xai';
import { createGoogle } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import {
  normalizeReasoningEffort,
  resolveBaseUrl,
  type LlmMediaType,
  type LlmProtocol,
} from './protocol.js';
import { getProtocolMediaRule, type LlmMediaRule } from './media.js';

/** LLM 客户端设置（协议 + 凭据） */
export interface LlmClientSettings {
  /** BaseURL（可空，按协议回退官方默认） */
  baseUrl?: unknown;
  /** API Key */
  apiKey: string;
}

/** 思考强度 providerOptions（可嵌套 JSON 值，兼容 AI SDK ProviderOptions 结构） */
export type LlmProviderOptions = { [provider: string]: { [key: string]: LlmProviderOptionValue } };

/** providerOptions 值类型（字符串/数字/布尔/嵌套对象/数组） */
export type LlmProviderOptionValue = string | number | boolean | null | LlmProviderOptionValue[] | { [key: string]: LlmProviderOptionValue };

/**
 * LLM 客户端：协议无关的统一调用封装。
 */
export interface LlmClient {
  /** 协议类型 */
  protocol: LlmProtocol;
  /** 已归一化的 BaseURL（原生 SSE 客户端直接拼接 `/chat/completions`） */
  baseUrl: string;
  /** API Key（原生 SSE 客户端鉴权用；不打印/不落日志） */
  apiKey: string;
  /**
   * 按模型 id 构建 AI SDK 语言模型实例（每次调用返回独立实例，无共享状态）。
   * @param modelId 模型 id（如 glm-5.3-flash / gpt-4o）
   * @returns 可传给 streamText 的语言模型
   */
  model(modelId: string): LanguageModel;
  /**
   * 按思考强度挡位构建 providerOptions（跨协议映射；该协议不支持思考强度时返回 undefined）。
   * @param effort 挡位值（low / medium / high 等，空串或非法返回 undefined）
   * @returns 直接可传给 streamText 的 providerOptions；不支持时 undefined
   */
  reasoningOptions(effort: string | undefined): LlmProviderOptions | undefined;
  /**
   * 该协议对某类媒体输入的传输规则（能力矩阵；忽略模型元信息，模型闸门由调用方合并）。
   * @param type 媒体类型（image / audio / video）
   * @returns 传输规则；该协议不支持该类型时 undefined
   */
  mediaRule(type: LlmMediaType): LlmMediaRule | undefined;
}

/**
 * 按协议构建 LLM 客户端。
 *
 * @param protocol 协议 id
 * @param settings 凭据设置（BaseURL 按协议回退官方默认）
 * @returns LLM 客户端
 */
export function createLlmClient(protocol: LlmProtocol, settings: LlmClientSettings): LlmClient {
  const baseURL = resolveBaseUrl(protocol, settings.baseUrl);
  const apiKey = settings.apiKey;
  /** 能力矩阵查询（各协议统一实现；协议差异集中在 media.ts 的规则表） */
  const mediaRule = (type: LlmMediaType): LlmMediaRule | undefined => getProtocolMediaRule(protocol, type);
  switch (protocol) {
    case 'openai-chat': {
      const provider = createOpenAI({ baseURL, apiKey });
      return {
        protocol,
        baseUrl: baseURL,
        apiKey,
        model: (modelId) => provider.chat(modelId),
        reasoningOptions: (effort) => {
          const e = normalizeReasoningEffort(effort);
          return e ? { openai: { reasoningEffort: e } } : undefined;
        },
        mediaRule,
      };
    }
    case 'openai-responses': {
      const provider = createOpenAI({ baseURL, apiKey });
      return {
        protocol,
        baseUrl: baseURL,
        apiKey,
        model: (modelId) => provider.responses(modelId),
        reasoningOptions: (effort) => {
          const e = normalizeReasoningEffort(effort);
          return e ? { openai: { reasoningEffort: e } } : undefined;
        },
        mediaRule,
      };
    }
    case 'anthropic': {
      const provider = createAnthropic({ baseURL, apiKey });
      return {
        protocol,
        baseUrl: baseURL,
        apiKey,
        model: (modelId) => provider(modelId),
        reasoningOptions: (effort) => {
          const e = normalizeReasoningEffort(effort);
          // Anthropic 思考为 budget tokens 方案：低/中/高映射 2048/4096/8192
          const budgets: Record<string, number> = { low: 2048, medium: 4096, high: 8192 };
          return e ? { anthropic: { thinking: { type: 'enabled', budgetTokens: budgets[e] ?? 4096 } } } : undefined;
        },
        mediaRule,
      };
    }
    case 'grok': {
      const provider = createXai({ baseURL, apiKey });
      return {
        protocol,
        // Grok 走 xAI Chat Completions 风格接口
        model: (modelId) => provider.chat(modelId),
        baseUrl: baseURL,
        apiKey,
        reasoningOptions: (effort) => {
          const e = normalizeReasoningEffort(effort);
          return e ? { xai: { reasoningEffort: e } } : undefined;
        },
        mediaRule,
      };
    }
    case 'gemini': {
      const provider = createGoogle({ baseURL, apiKey });
      return {
        protocol,
        baseUrl: baseURL,
        apiKey,
        model: (modelId) => provider(modelId),
        reasoningOptions: (effort) => {
          const e = normalizeReasoningEffort(effort);
          // Gemini 思考预算为 token 数：低/中/高映射 1024/2048/4096
          const budgets: Record<string, number> = { low: 1024, medium: 2048, high: 4096 };
          return e ? { google: { thinkingConfig: { thinkingBudget: budgets[e] ?? 2048 } } } : undefined;
        },
        mediaRule,
      };
    }
  }
}
