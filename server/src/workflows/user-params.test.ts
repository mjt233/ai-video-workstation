import { describe, expect, it } from 'vitest';
import { toNativeUserParams } from './user-params.js';
import type { WorkflowUserParamDeclaration } from './types.js';

describe('toNativeUserParams', () => {
  const declarations: WorkflowUserParamDeclaration[] = [
    { key: 'enable_multiple_angles_lora', name: '多机位LoRA', type: 'boolean', defaultValue: false },
    { key: 'width', name: '宽度', type: 'integer', defaultValue: '' },
    { key: 'temperature', name: '温度', type: 'float', defaultValue: '' },
    { key: 'prompt', name: '提示词', type: 'string', defaultValue: '' },
  ];

  it('按声明类型将字符串还原为原生值', () => {
    expect(toNativeUserParams(declarations, {
      enable_multiple_angles_lora: 'true',
      width: '720',
      temperature: '0.8',
      prompt: '猫',
    })).toEqual({
      enable_multiple_angles_lora: true,
      width: 720,
      temperature: 0.8,
      prompt: '猫',
    });
  });

  it('boolean false 还原为 false', () => {
    expect(toNativeUserParams(declarations, { enable_multiple_angles_lora: 'false' })).toEqual({
      enable_multiple_angles_lora: false,
    });
  });

  it('未声明键按字符串保留', () => {
    expect(toNativeUserParams(declarations, { unknown_key: 'x' })).toEqual({ unknown_key: 'x' });
  });

  it('空声明 / 空输入 → 空对象', () => {
    expect(toNativeUserParams(undefined, undefined)).toEqual({});
    expect(toNativeUserParams([], {})).toEqual({});
  });
});
