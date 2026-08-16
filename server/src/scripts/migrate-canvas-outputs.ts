/**
 * 画布节点产物一次性迁移：v{n}.{ext} → output.{ext}。
 *
 * 背景：画布节点产物从「客户端预计算 version 的 v{n} 文件名」改为「固定 output.{ext} 文件名」
 * （历史由服务端 history/ 目录管理，与分镜场景图一致）。既有项目里节点产物仍是 v{n} 形态，
 * 本脚本把每个节点目录内：
 *   - 版本号最高的 v{n}.{ext} → 迁移为 output.{ext}（作为当前结果展示）；
 *   - 其余 v{n}.{ext} → 移入 history/output/{时间戳}.{ext}（保留历史，供服务端历史 API 展示）。
 *
 * 幂等：节点目录已存在 output.{ext}（或没有 v{n} 文件）时跳过。脚本只改 assert/ 产物文件，
 * 不改 canvas.json（新前端对生成节点按固定路径推导当前产物，旧 config.current/history 字段失效但无害）。
 *
 * 用法：cd server && npx tsx src/scripts/migrate-canvas-outputs.ts [project]
 *   不带 project 参数时遍历 design/ 下全部项目。
 */
import fs from 'fs/promises';
import path from 'path';
import { DESIGN_DIR } from '../assets/paths.js';
import { formatHistoryStamp } from '../assets/history.js';

/** 节点目录内版本化产物文件（v{n}.*） */
function collectVersions(files: string[]): { name: string; version: number; ext: string }[] {
  const out: { name: string; version: number; ext: string }[] = [];
  for (const name of files) {
    const m = /^v(\d+)\.([A-Za-z0-9]+)$/.exec(name);
    if (m) out.push({ name, version: Number(m[1]), ext: m[2].toLowerCase() });
  }
  return out.sort((a, b) => b.version - a.version);
}

/**
 * 迁移单个节点目录。
 *
 * @param project 项目名
 * @param nodeDirRel assert 下节点目录相对路径（如 assert/scene/1/1/canvas/n1）
 * @returns 迁移摘要：{ moved, current }；无 v{n} 文件或已有 output 时返回 null
 */
async function migrateNodeDir(
  project: string,
  nodeDirRel: string,
): Promise<{ moved: string[]; current: string } | null> {
  const nodeDirFull = path.resolve(DESIGN_DIR, project, nodeDirRel);
  const entries = await fs.readdir(nodeDirFull).catch(() => null);
  if (!entries) return null;
  const versions = collectVersions(entries);
  if (versions.length === 0) return null;

  // 节点输出扩展名以最高版本文件的扩展名为准（同目录内通常一致）
  const ext = versions[0].ext;
  const currentRel = `${nodeDirRel}/output.${ext}`;
  const currentFull = path.resolve(DESIGN_DIR, project, currentRel);
  const exists = await fs.access(currentFull).then(() => true).catch(() => false);
  if (exists) return null; // 已迁移过（幂等）

  const moved: string[] = [];
  for (let i = 0; i < versions.length; i += 1) {
    const v = versions[i];
    const srcFull = path.resolve(DESIGN_DIR, project, `${nodeDirRel}/${v.name}`);
    if (i === 0) {
      // 最高版本 → output.{ext}
      await fs.rename(srcFull, currentFull);
      moved.push(v.name);
    } else {
      // 其余 → history/output/{mtime 时间戳}.{ext}
      const stat = await fs.stat(srcFull).catch(() => null);
      const stamp = formatHistoryStamp(stat?.mtime ? new Date(stat.mtime) : new Date());
      const histDirFull = path.resolve(DESIGN_DIR, project, `${nodeDirRel}/history/output`);
      await fs.mkdir(histDirFull, { recursive: true });
      let destRel = `${nodeDirRel}/history/output/${stamp}.${ext}`;
      let destFull = path.resolve(DESIGN_DIR, project, destRel);
      let n = 1;
      while (await fs.access(destFull).then(() => true).catch(() => false)) {
        destRel = `${nodeDirRel}/history/output/${stamp}-${n}.${ext}`;
        destFull = path.resolve(DESIGN_DIR, project, destRel);
        n += 1;
      }
      await fs.rename(srcFull, destFull);
      moved.push(v.name);
    }
  }
  return { moved, current: currentRel };
}

/**
 * 迁移一个项目下全部画布节点目录。
 *
 * @param project 项目名
 * @returns 迁移统计
 */
async function migrateProject(project: string): Promise<{ migratedDirs: number; movedFiles: number }> {
  const assertRoot = path.resolve(DESIGN_DIR, project, 'assert');
  const stat = await fs.stat(assertRoot).catch(() => null);
  if (!stat?.isDirectory()) {
    return { migratedDirs: 0, movedFiles: 0 };
  }

  let migratedDirs = 0;
  let movedFiles = 0;

  // 遍历 assert/ 下全部目录：节点目录 = 直接内含 v{n} 产物文件的目录
  // （分镜画布 canvas/{nodeId}、场景画布 canvas/{label}/{nodeId} 均适用）；
  // 非节点目录（canvas/{label} 中间层等）继续深入递归
  const walk = async (dirRel: string): Promise<void> => {
    const dirFull = path.resolve(DESIGN_DIR, project, dirRel);
    const entries = await fs.readdir(dirFull, { withFileTypes: true }).catch(() => null);
    if (!entries) return;
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'history') continue;
      const childRel = `${dirRel}/${e.name}`;
      const migrated = await migrateNodeDir(project, childRel);
      if (migrated) {
        migratedDirs += 1;
        movedFiles += migrated.moved.length;
        console.log(`  [${project}] ${childRel}: ${migrated.moved.join(', ')} → ${migrated.current}`);
      } else {
        await walk(childRel);
      }
    }
  };

  await walk('assert');
  return { migratedDirs, movedFiles };
}

async function main(): Promise<void> {
  const target = process.argv[2];
  const projects = target
    ? [target]
    : (await fs.readdir(DESIGN_DIR, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

  let totalMigrated = 0;
  let totalFiles = 0;
  for (const project of projects) {
    const r = await migrateProject(project);
    if (r.migratedDirs > 0) {
      totalMigrated += r.migratedDirs;
      totalFiles += r.movedFiles;
      console.log(`[${project}] 迁移 ${r.migratedDirs} 个节点目录，${r.movedFiles} 个产物文件`);
    }
  }
  console.log(`完成：共迁移 ${totalMigrated} 个节点目录，${totalFiles} 个产物文件。`);
}

main().catch((e) => {
  console.error('迁移失败:', e);
  process.exit(1);
});