/**
 * 画布文本历史版本（`canvas/text-history.ts`）单测。
 *
 * 这组规则必须与前端 `frontend/src/canvas/aiTextHistory.ts` 完全一致
 * （同一画布上 AI 文本节点与文本生成节点共用同一个历史对话框），
 * 故这里固化字段过滤、上限截断与 id 生成三条规则。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_TEXT_HISTORY_VERSIONS,
  appendTextHistory,
  createTextHistoryId,
  readTextHistory,
  sanitizeTextHistoryEntry,
  type TextHistoryEntry,
} from './text-history.js';

/** 合法历史条目 */
function entry(i: number, extra: Partial<TextHistoryEntry> = {}): TextHistoryEntry {
  return {
    id: `h${i}`,
    createdAt: new Date(1_700_000_000_000 + i).toISOString(),
    input: `in${i}`,
    output: `out${i}`,
    ...extra,
  };
}

describe('createTextHistoryId', () => {
  it('生成「时间戳 36 进制-随机后缀」形式的非空 id，且两次调用不重复', () => {
    const at = new Date(1_700_000_000_000);
    const a = createTextHistoryId(at);
    const b = createTextHistoryId(at);
    expect(a).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
    expect(a).not.toBe(b);
  });
});

describe('sanitizeTextHistoryEntry', () => {
  it('合法条目原样保留（含可选展示字段）', () => {
    expect(sanitizeTextHistoryEntry(entry(1, {
      modelName: '模型A',
      presetName: '预设B',
      mediaLabels: ['图1.png'],
    }))).toEqual(entry(1, { modelName: '模型A', presetName: '预设B', mediaLabels: ['图1.png'] }));
  });

  it('缺 id/createdAt/input/output 的脏数据一律丢弃', () => {
    expect(sanitizeTextHistoryEntry(null)).toBeNull();
    expect(sanitizeTextHistoryEntry('x')).toBeNull();
    expect(sanitizeTextHistoryEntry({})).toBeNull();
    expect(sanitizeTextHistoryEntry({ id: '', createdAt: 't', input: '', output: '' })).toBeNull();
    expect(sanitizeTextHistoryEntry({ id: 'a', createdAt: '', input: '', output: '' })).toBeNull();
    expect(sanitizeTextHistoryEntry({ id: 'a', createdAt: 't', input: 1, output: '' })).toBeNull();
    expect(sanitizeTextHistoryEntry({ id: 'a', createdAt: 't', input: '', output: null })).toBeNull();
  });

  it('可选字段非法时被剥离（不因脏字段丢弃整条）', () => {
    const out = sanitizeTextHistoryEntry({
      id: 'a',
      createdAt: 't',
      input: 'i',
      output: 'o',
      modelName: 123,
      presetName: '',
      mediaLabels: ['ok', 2],
    });
    expect(out).toEqual({ id: 'a', createdAt: 't', input: 'i', output: 'o' });
  });

  it('mediaLabels 全为字符串时保留', () => {
    const out = sanitizeTextHistoryEntry({
      id: 'a', createdAt: 't', input: 'i', output: 'o', mediaLabels: ['a.png', 'b.mp4'],
    });
    expect(out?.mediaLabels).toEqual(['a.png', 'b.mp4']);
  });
});

describe('readTextHistory', () => {
  it('缺失/非法 outputHistory 回退空数组，脏条目被过滤', () => {
    expect(readTextHistory(undefined)).toEqual([]);
    expect(readTextHistory({})).toEqual([]);
    expect(readTextHistory({ outputHistory: 'x' })).toEqual([]);
    expect(readTextHistory({ outputHistory: [entry(1), { bad: true }, entry(2)] })).toEqual([
      entry(1),
      entry(2),
    ]);
  });
});

describe('appendTextHistory', () => {
  it('新条目追加在末尾（末尾为最新）', () => {
    expect(appendTextHistory([entry(1)], entry(2)).map((e) => e.id)).toEqual(['h1', 'h2']);
  });

  it(`超过 ${MAX_TEXT_HISTORY_VERSIONS} 条时丢弃最旧`, () => {
    const full = Array.from({ length: MAX_TEXT_HISTORY_VERSIONS }, (_, i) => entry(i));
    const next = appendTextHistory(full, entry(999));
    expect(next).toHaveLength(MAX_TEXT_HISTORY_VERSIONS);
    expect(next[0].id).toBe('h1'); // h0 被丢弃
    expect(next[next.length - 1].id).toBe('h999');
  });
});
