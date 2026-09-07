/**
 * 资产画布定义（canvas.json）的保存版本号（rev）与 CAS（Compare-And-Swap）读写。
 *
 * 背景：画布自动保存通过 `PUT /api/canvas/def` 仅写入"当前最新"的画布定义，
 * 防止两类覆盖事故：
 * 1. 分镜插入/删除/移动等操作由服务端改写全项目 canvas.json 引用路径后，
 *    停留页面上旧版本的自动保存把改写结果覆盖掉（引用失效）；
 * 2. 同一个画布被多个用户同时编辑，后保存者无提示地覆盖先保存者的修改。
 *
 * 约定：
 * - canvas.json 顶层新增整型字段 `rev`（保存版本号），缺失/旧文件按 0 处理；
 *   画布内原有的 `version` 字段是 **schema 版本**（前端 CANVAS_SCHEMA_VERSION），
 *   与 `rev` 语义不同，二者互不影响。
 * - 每次成功保存（含本模块的 CAS 保存，以及服务端对 canvas.json 的自动改写，
 *   见 shot-renumber.ts / shot-move.ts）后端都把 rev 置为"当前值 + 1"。
 * - 非 force 保存要求 `expectedRev === 当前 rev`，否则抛 VERSION_CONFLICT（HTTP 409）。
 * - 同一路径的「读-比-写」在进程内按路径互斥，保证并发保存不交错（单进程服务即可）。
 */

import fs from 'fs/promises';
import path from 'path';
import {
  assertPositiveIntId,
  assertSafeName,
  ensureDir,
  pathExists,
  resolveProjectPath,
} from './paths.js';

/** 画布类型：分镜画布 / 场景画布 */
export type CanvasDefKind = 'scene' | 'stage';

/** 画布目标：定位一张画布定义文件 */
export interface CanvasDefTarget {
  kind: CanvasDefKind;
  /** 分镜画布时的集数 */
  episode?: string;
  /** 分镜画布时的分镜号 */
  shot?: string;
  /** 场景画布时的场景名 */
  stage?: string;
  /** 场景画布时的子场景标签 */
  label?: string;
}

/** 路径级互斥锁队列（key = 规范化相对路径） */
const pathLocks = new Map<string, Promise<unknown>>();

/**
 * 按 key 串行执行任务（进程内互斥）：后到的调用排队等待前一个完成。
 * 前一个任务失败不影响后续排队任务执行。
 *
 * @param key 互斥键（如 `canvas:prompt/scene/1/1/canvas.json`）
 * @param task 互斥任务
 * @returns 任务返回值
 */
export async function withPathLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = pathLocks.get(key) ?? Promise.resolve();
  const run = prev.then(task, task);
  // 链上吞掉异常，避免一个失败任务阻塞后续所有排队者
  pathLocks.set(key, run.then(
    () => undefined,
    () => undefined,
  ));
  return run;
}

/**
 * 计算画布定义文件的相对路径并做目标参数校验。
 *
 * - 分镜画布：prompt/scene/{集数}/{分镜}/canvas.json
 * - 场景画布：prompt/stage/{场景名}/canvas/{子场景标签}.json
 *
 * @param target 画布目标
 * @returns 项目内相对路径
 * @throws code=INVALID 目标参数缺省/非法
 */
export function canvasDefRelPath(target: CanvasDefTarget): string {
  if (target.kind === 'stage') {
    const stage = (target.stage ?? '').trim();
    const label = (target.label ?? '').trim();
    if (!stage || !label) {
      throw Object.assign(new Error('stage 与 label 必填'), { code: 'INVALID' });
    }
    assertSafeName(stage, '场景名');
    assertSafeName(label, '子场景标签');
    return `prompt/stage/${stage}/canvas/${label}.json`;
  }
  if (target.kind === 'scene') {
    const episode = String(target.episode ?? '').trim();
    const shot = String(target.shot ?? '').trim();
    if (!episode || !shot) {
      throw Object.assign(new Error('episode 与 shot 必填'), { code: 'INVALID' });
    }
    assertPositiveIntId(episode, '集数');
    assertPositiveIntId(shot, '分镜');
    return `prompt/scene/${episode}/${shot}/canvas.json`;
  }
  throw Object.assign(new Error('kind 必须是 scene 或 stage'), { code: 'INVALID' });
}

/**
 * 给 JSON 文本中的画布定义 bump 版本号（rev +1，updatedAt 刷新）。
 *
 * 供服务端自动改写 canvas.json（分镜重编号/移动的引用路径修正）后调用：
 * 引用被改写即视为"画布被外部修改"，推进 rev 使停留页面的旧版本自动保存
 * 触发版本冲突（409），从而避免旧数据覆盖新引用。
 *
 * @param text 改写后的 canvas.json 原文
 * @returns bump 后的 JSON 文本（保持 2 空格缩进 + 末尾换行）；解析失败时原样返回
 */
export function bumpCanvasRevInJsonText(text: string): string {
  try {
    const obj: unknown = JSON.parse(text);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return text;
    const data = obj as Record<string, unknown>;
    const revRaw = Number(data.rev);
    data.rev = Number.isInteger(revRaw) && revRaw >= 0 ? revRaw + 1 : 1;
    data.updatedAt = new Date().toISOString();
    return `${JSON.stringify(data, null, 2)}\n`;
  } catch {
    // 文件内容非法 JSON：无法 bump，按原样返回（改写函数已尽力；非法文件不在正常流程内）
    return text;
  }
}

/**
 * 读取画布定义当前版本号（rev）与更新时间。
 *
 * @param project 项目名
 * @param target 画布目标
 * @returns rev（文件不存在/无 rev 字段时为 0）、是否存在、updatedAt（可空）
 * @throws code=INVALID 目标参数非法；文件损坏时抛出 code=CORRUPT（由路由层映射为 409）
 */
export async function readCanvasDefRev(
  project: string,
  target: CanvasDefTarget,
): Promise<{ rev: number; exists: boolean; updatedAt: string | null }> {
  const rel = canvasDefRelPath(target);
  const full = resolveProjectPath(project, rel);
  if (!(await pathExists(full))) {
    return { rev: 0, exists: false, updatedAt: null };
  }
  try {
    const raw = await fs.readFile(full, 'utf8');
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw Object.assign(new Error('画布定义文件已损坏，无法保存'), { code: 'CORRUPT' });
    }
    const data = obj as Record<string, unknown>;
    const revRaw = Number(data.rev);
    const rev = Number.isInteger(revRaw) && revRaw >= 0 ? revRaw : 0;
    const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : null;
    return { rev, exists: true, updatedAt };
  } catch (err) {
    if ((err as { code?: string }).code === 'CORRUPT') throw err;
    // 文件不存在（并发删除）或 JSON 非法：按损坏处理，交由调用方提示
    throw Object.assign(new Error('画布定义文件已损坏，无法保存'), { code: 'CORRUPT' });
  }
}

/**
 * CAS 保存画布定义：expectedRev 与当前 rev 一致（或 force=true）时写入，
 * 写入内容由后端注入 rev = 当前 rev + 1 与 updatedAt = 当前时间。
 *
 * 保存过程在进程内按路径互斥，保证「读-比-写」原子。
 *
 * @param project 项目名
 * @param target 画布目标
 * @param data 前端画布定义（不含 rev；rev 由后端统一维护）
 * @param expectedRev 前端基于的版本号（首次保存/无版本旧文件为 0）
 * @param force 强制覆盖：跳过版本比对（仅用户明确确认后使用）
 * @returns 保存后的新版本号与更新时间
 * @throws code=INVALID 参数非法；code=VERSION_CONFLICT 版本不一致（409）
 * @throws code=CORRUPT 现有文件损坏（409）
 */
export async function saveCanvasDef(
  project: string,
  target: CanvasDefTarget,
  data: unknown,
  expectedRev: number | undefined,
  force: boolean,
): Promise<{ rev: number; updatedAt: string }> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw Object.assign(new Error('data 必须是对象'), { code: 'INVALID' });
  }
  if (!force && (expectedRev === undefined || !Number.isInteger(expectedRev) || expectedRev < 0)) {
    throw Object.assign(new Error('expectedRev 必填且必须是非负整数'), { code: 'INVALID' });
  }
  const rel = canvasDefRelPath(target);
  const dataObj = data as Record<string, unknown>;
  // 类型一致性校验：kind 缺失时由前端决定，存在时须与目标一致（防止写错画布文件）
  if (dataObj.kind !== undefined && dataObj.kind !== target.kind) {
    throw Object.assign(new Error('data.kind 与目标画布类型不一致'), { code: 'INVALID' });
  }
  return withPathLock(`canvas:${rel}`, async () => {
    const current = await readCanvasDefRev(project, target);
    if (!force && expectedRev !== current.rev) {
      throw Object.assign(
        new Error(
          `画布保存冲突：画布已被其他人或引用更新修改（当前版本 ${current.rev}，您基于版本 ${expectedRev} 编辑）。`
          + '请手动备份当前画布，或选择强制覆盖保存。',
        ),
        { code: 'VERSION_CONFLICT', currentRev: current.rev, expectedRev },
      );
    }
    const updatedAt = new Date().toISOString();
    const payload = {
      ...dataObj,
      rev: current.rev + 1,
      updatedAt,
    };
    const full = resolveProjectPath(project, rel);
    await ensureDir(path.dirname(full));
    await fs.writeFile(full, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
    return { rev: current.rev + 1, updatedAt };
  });
}
