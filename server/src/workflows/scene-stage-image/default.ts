import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createImageEditWorkflow } from '../bridge-client.js';
import { register } from '../registry.js';

const DESIGN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../design');

interface SceneStageDefinition {
  基础场景: string;
  登场角色?: string[];
  prompt: string;
}

async function loadAssertImage(project: string, relPath: string): Promise<File> {
  const full = path.resolve(DESIGN_DIR, project, relPath);
  const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;
  if (!full.startsWith(projectRoot)) {
    throw new Error(`Path traversal denied: ${relPath}`);
  }
  try {
    const buf = await fs.readFile(full);
    const filename = path.basename(full);
    return new File([buf], filename, { type: 'image/jpeg' });
  } catch {
    throw new Error(`参考图不存在: ${relPath}`);
  }
}

register(createImageEditWorkflow({
  id: 'scene-stage-image',
  name: '场景图编辑',
  impl: 'default',
  description: '基于参考图编辑生成场景图',
  async getParams(params) {
    const { episode, shot } = params.vars;
    const index = Number(params.vars.index ?? '0');
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`无效的分镜场景索引 index=${params.vars.index}`);
    }

    const defs = JSON.parse(
      await params.readFile(`prompt/scene/${episode}/${shot}/stage.json`),
    ) as SceneStageDefinition[];
    if (!Array.isArray(defs) || index >= defs.length) {
      throw new Error(
        `分镜场景索引越界: index=${index}, stage.json 共 ${Array.isArray(defs) ? defs.length : 0} 项`,
      );
    }

    const stage = defs[index];
    const imgs: File[] = [];

    // 图像1：基础场景图 assert/stage/{场景名}/{标签}.jpg
    const slash = stage.基础场景.indexOf('/');
    if (slash <= 0 || slash === stage.基础场景.length - 1) {
      throw new Error(`基础场景格式无效（期望 场景名/标签）: ${stage.基础场景}`);
    }
    const stageName = stage.基础场景.slice(0, slash);
    const stageLabel = stage.基础场景.slice(slash + 1);
    imgs.push(await loadAssertImage(params.project, `assert/stage/${stageName}/${stageLabel}.jpg`));

    // 图像2+：登场角色外观图
    for (const character of stage.登场角色 ?? []) {
      imgs.push(await loadAssertImage(params.project, `assert/character/${character}/appearance.jpg`));
    }

    return {
      desc: stage.prompt,
      imgs,
      seed: params.vars.seed,
    };
  },
}));
