import { mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BLUEPRINT_NODE_LIMIT,
  blueprintFile,
  createBlueprint,
  deleteBlueprint,
  findBlueprintIdByName,
  getBlueprint,
  listBlueprints,
  updateBlueprint,
  validatePayload,
  type BlueprintDirs,
  type BlueprintPayload,
} from './store.js';

let dirs: BlueprintDirs;

/** 构造最小蓝图载荷 */
function payload(nodeCount = 2): BlueprintPayload {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i}`,
    prototypeId: 'text',
    name: `节点${i}`,
    x: i * 300,
    y: 0,
    width: 240,
    height: 160,
    config: { text: `t${i}` },
  }));
  return {
    nodes,
    connections: nodeCount >= 2 ? [{ id: 'c1', fromNodeId: 'n0', fromPortId: 'out', toNodeId: 'n1', toPortId: 'in' }] : [],
    groups: [{ id: 'g1', name: '分组 1', color: '#1976D2', x: -12, y: -12, width: 600, height: 200 }],
  };
}

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'blueprints-'));
  dirs = {
    globalDir: path.join(root, 'config-blueprints'),
    projectBaseDir: path.join(root, 'design'),
  };
  // 预置两个项目目录，供 assetProject 校验
  await mkdir(path.join(dirs.projectBaseDir, '项目A'), { recursive: true });
  await mkdir(path.join(dirs.projectBaseDir, '项目B'), { recursive: true });
});

describe('createBlueprint / listBlueprints', () => {
  it('创建全局蓝图：落盘一文件、rev=1、返回内容完整', async () => {
    const bp = await createBlueprint({
      scope: 'global',
      name: '三视图',
      description: '描述',
      assetProject: '项目A',
      payload: payload(),
      dirs,
    });
    expect(bp.rev).toBe(1);
    expect(bp.assetProject).toBe('项目A');
    expect(bp.nodes).toHaveLength(2);
    expect(bp.connections).toHaveLength(1);
    expect(bp.groups).toHaveLength(1);
    const file = blueprintFile({ scope: 'global' }, bp.id, dirs);
    expect(JSON.parse(await readFile(file, 'utf-8')).name).toBe('三视图');
  });

  it('名称去首尾空白、描述可空、assetProject 可空', async () => {
    const bp = await createBlueprint({ scope: 'global', name: '  名称  ', payload: payload(1), dirs });
    expect(bp.name).toBe('名称');
    expect(bp.description).toBe('');
    expect(bp.assetProject).toBeNull();
  });

  it('列表按更新时间倒序并返回摘要计数', async () => {
    const first = await createBlueprint({ scope: 'global', name: 'A', payload: payload(3), dirs });
    const second = await createBlueprint({ scope: 'global', name: 'B', payload: payload(1), dirs });
    // 让 A 的更新时间晚于 B
    await updateBlueprint({
      scope: 'global',
      id: first.id,
      patch: { description: 'touch' },
      expectedRev: 1,
      dirs,
    });
    const list = await listBlueprints({ scope: 'global' }, dirs);
    expect(list.map((b) => b.name)).toEqual(['A', 'B']);
    expect(list[0]).toMatchObject({ nodeCount: 3, connectionCount: 1, groupCount: 1, rev: 2 });
    expect(list[0].prototypeCounts).toEqual({ text: 3 });
    expect(list[1].id).toBe(second.id);
  });

  it('损坏的蓝图文件在列表中被跳过并输出日志', async () => {
    await createBlueprint({ scope: 'global', name: 'OK', payload: payload(1), dirs });
    await writeFile(path.join(dirs.globalDir, 'broken.json'), '{ not json', 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const list = await listBlueprints({ scope: 'global' }, dirs);
    warn.mockRestore();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('OK');
  });

  it('同名蓝图：默认抛 EXISTS（携带 existingId），overwrite=true 覆盖既有蓝图', async () => {
    const first = await createBlueprint({ scope: 'global', name: '同名', payload: payload(1), dirs });
    await expect(createBlueprint({ scope: 'global', name: '同名', payload: payload(2), dirs }))
      .rejects.toMatchObject({ code: 'EXISTS', existingId: first.id });
    const overwritten = await createBlueprint({ scope: 'global', name: '同名', payload: payload(2), overwrite: true, dirs });
    expect(overwritten.id).toBe(first.id);
    expect(overwritten.nodes).toHaveLength(2);
    expect(await listBlueprints({ scope: 'global' }, dirs)).toHaveLength(1);
  });
});

describe('项目级蓝图', () => {
  it('存放在 design/{项目}/prompt/blueprint/，assetProject 强制为所属项目', async () => {
    const bp = await createBlueprint({
      scope: 'project',
      project: '项目A',
      name: '项目蓝图',
      assetProject: '项目B',
      payload: payload(),
      dirs,
    });
    expect(bp.assetProject).toBe('项目A');
    const expected = path.join(dirs.projectBaseDir, '项目A', 'prompt', 'blueprint', `${bp.id}.json`);
    expect(blueprintFile({ scope: 'project', project: '项目A' }, bp.id, dirs)).toBe(expected);
    await expect(readFile(expected, 'utf-8')).resolves.toContain('项目蓝图');
  });

  it('不同项目的同名蓝图互不冲突', async () => {
    const a = await createBlueprint({ scope: 'project', project: '项目A', name: '同名', payload: payload(1), dirs });
    const b = await createBlueprint({ scope: 'project', project: '项目B', name: '同名', payload: payload(1), dirs });
    expect(a.id).not.toBe(b.id);
    expect(await listBlueprints({ scope: 'project', project: '项目A' }, dirs)).toHaveLength(1);
    expect(await listBlueprints({ scope: 'project', project: '项目B' }, dirs)).toHaveLength(1);
  });

  it('scope=project 缺项目名 / 项目名非法时报 INVALID', async () => {
    await expect(createBlueprint({ scope: 'project', name: 'x', payload: payload(1), dirs }))
      .rejects.toMatchObject({ code: 'INVALID' });
    await expect(createBlueprint({ scope: 'project', project: '../escape', name: 'x', payload: payload(1), dirs }))
      .rejects.toMatchObject({ code: 'INVALID' });
    await expect(createBlueprint({ scope: 'project', project: '.trash', name: 'x', payload: payload(1), dirs }))
      .rejects.toMatchObject({ code: 'INVALID' });
  });
});

describe('assetProject 校验', () => {
  it('全局蓝图 assetProject 必须真实存在', async () => {
    await expect(createBlueprint({ scope: 'global', name: 'x', assetProject: '不存在', payload: payload(1), dirs }))
      .rejects.toMatchObject({ code: 'INVALID' });
    const ok = await createBlueprint({ scope: 'global', name: 'x', assetProject: '项目B', payload: payload(1), dirs });
    expect(ok.assetProject).toBe('项目B');
  });

  it('更新时可设置/清空 assetProject', async () => {
    const bp = await createBlueprint({ scope: 'global', name: 'x', payload: payload(1), dirs });
    const set = await updateBlueprint({
      scope: 'global',
      id: bp.id,
      patch: { assetProject: '项目A' },
      expectedRev: bp.rev,
      dirs,
    });
    expect(set.assetProject).toBe('项目A');
    const cleared = await updateBlueprint({
      scope: 'global',
      id: bp.id,
      patch: { assetProject: null },
      expectedRev: set.rev,
      dirs,
    });
    expect(cleared.assetProject).toBeNull();
  });
});

describe('getBlueprint / updateBlueprint（CAS）', () => {
  it('按 id 读取，不存在抛 NOT_FOUND', async () => {
    const bp = await createBlueprint({ scope: 'global', name: 'x', payload: payload(1), dirs });
    expect((await getBlueprint({ scope: 'global' }, bp.id, dirs)).name).toBe('x');
    await expect(getBlueprint({ scope: 'global' }, 'missing', dirs)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('版本不一致抛 VERSION_CONFLICT（携带 currentRev / expectedRev）', async () => {
    const bp = await createBlueprint({ scope: 'global', name: 'x', payload: payload(1), dirs });
    await updateBlueprint({ scope: 'global', id: bp.id, patch: { description: 'a' }, expectedRev: bp.rev, dirs });
    await expect(
      updateBlueprint({ scope: 'global', id: bp.id, patch: { description: 'b' }, expectedRev: bp.rev, dirs }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', currentRev: 2, expectedRev: 1 });
  });

  it('force=true 跳过版本比对并继续递增 rev', async () => {
    const bp = await createBlueprint({ scope: 'global', name: 'x', payload: payload(1), dirs });
    const forced = await updateBlueprint({ scope: 'global', id: bp.id, patch: { name: 'y' }, force: true, dirs });
    expect(forced.rev).toBe(2);
    expect(forced.name).toBe('y');
  });

  it('局部更新：只改 name 时节点/连线/分组保持原值', async () => {
    const bp = await createBlueprint({ scope: 'global', name: 'x', payload: payload(3), dirs });
    const updated = await updateBlueprint({ scope: 'global', id: bp.id, patch: { name: '新名' }, expectedRev: 1, dirs });
    expect(updated.nodes).toHaveLength(3);
    expect(updated.connections).toHaveLength(1);
    expect(updated.groups).toHaveLength(1);
  });

  it('改名撞到其他蓝图时抛 EXISTS', async () => {
    const a = await createBlueprint({ scope: 'global', name: 'A', payload: payload(1), dirs });
    await createBlueprint({ scope: 'global', name: 'B', payload: payload(1), dirs });
    await expect(
      updateBlueprint({ scope: 'global', id: a.id, patch: { name: 'B' }, expectedRev: 1, dirs }),
    ).rejects.toMatchObject({ code: 'EXISTS' });
  });

  it('expectedRev 缺失且非 force 时抛 INVALID', async () => {
    const bp = await createBlueprint({ scope: 'global', name: 'x', payload: payload(1), dirs });
    await expect(updateBlueprint({ scope: 'global', id: bp.id, patch: { name: 'y' }, dirs }))
      .rejects.toMatchObject({ code: 'INVALID' });
  });
});

describe('deleteBlueprint', () => {
  it('删除后读取与列表均不可见；重复删除抛 NOT_FOUND', async () => {
    const bp = await createBlueprint({ scope: 'global', name: 'x', payload: payload(1), dirs });
    await deleteBlueprint({ scope: 'global' }, bp.id, dirs);
    expect(await listBlueprints({ scope: 'global' }, dirs)).toHaveLength(0);
    await expect(getBlueprint({ scope: 'global' }, bp.id, dirs)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(deleteBlueprint({ scope: 'global' }, bp.id, dirs)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('蓝图 id 非法（路径穿越）时抛 INVALID', async () => {
    await expect(deleteBlueprint({ scope: 'global' }, '../evil', dirs)).rejects.toMatchObject({ code: 'INVALID' });
    await expect(getBlueprint({ scope: 'global' }, 'a/b', dirs)).rejects.toMatchObject({ code: 'INVALID' });
  });
});

describe('validatePayload', () => {
  it('拒绝非法载荷并指明位置', () => {
    expect(() => validatePayload(null)).toThrow('蓝图内容必须是对象');
    expect(() => validatePayload({ nodes: 'x' })).toThrow('nodes 必须是数组');
    expect(() => validatePayload({ nodes: [{ id: 'a' }] })).toThrow('prototypeId 非法');
    expect(() => validatePayload({ nodes: [{ id: 'a', prototypeId: 'text', name: 'n', x: 0, y: 0, width: 1, height: 1, config: {} }], connections: [{ id: 'c', fromNodeId: 'a', fromPortId: 'out', toNodeId: 'zzz', toPortId: 'in' }] }))
      .toThrow('端点节点不存在');
    expect(() => validatePayload({ groups: [{ id: 'g' }] })).toThrow('name 非法');
  });

  it('节点数超过上限时拒绝', () => {
    const nodes = Array.from({ length: BLUEPRINT_NODE_LIMIT + 1 }, (_, i) => ({
      id: `n${i}`,
      prototypeId: 'text',
      name: 'n',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      config: {},
    }));
    expect(() => validatePayload({ nodes })).toThrow(`不能超过 ${BLUEPRINT_NODE_LIMIT}`);
  });

  it('规范化载荷（补齐缺省数组）', () => {
    expect(validatePayload({})).toEqual({ nodes: [], connections: [], groups: [] });
  });
});

describe('findBlueprintIdByName', () => {
  it('命中返回 id，未命中返回 null', async () => {
    const bp = await createBlueprint({ scope: 'global', name: '唯一', payload: payload(1), dirs });
    expect(await findBlueprintIdByName({ scope: 'global' }, '唯一', dirs)).toBe(bp.id);
    expect(await findBlueprintIdByName({ scope: 'global' }, '别的', dirs)).toBeNull();
  });
});
