import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createImageEditWorkflow } from '../bridge-client.js';
import { register } from '../registry.js';

const DESIGN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../design');

interface SceneStageDefinition {
  基础场景: string;
  登场角色?: string[];
  prompt?: string;
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
  description: '基于基础场景图与角色外观图合成分镜场景图（直接引用由调度引擎处理）',
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
    const baseStage = (stage.基础场景 ?? '').trim();
    if (!baseStage) {
      throw new Error('基础场景不能为空');
    }

    const characters = stage.登场角色 ?? [];
    const prompt = (stage.prompt ?? '').trim();
    // 直接引用由调度引擎短路处理；此处若仍进入说明约定被破坏
    if (characters.length === 0 && !prompt) {
      throw new Error('直接引用基础场景应由调度引擎处理，不应进入图像编辑工作流');
    }
    if (!prompt) {
      throw new Error('非直接引用时 prompt 不能为空（有登场角色时必须提供合成提示词）');
    }

    const imgs: File[] = [];

    // 图像1：基础场景图 assert/stage/{场景名}/{标签}.jpg
    const slash = baseStage.indexOf('/');
    if (slash <= 0 || slash === baseStage.length - 1) {
      throw new Error(`基础场景格式无效（期望 场景名/标签）: ${baseStage}`);
    }
    const stageName = baseStage.slice(0, slash);
    const stageLabel = baseStage.slice(slash + 1);
    imgs.push(await loadAssertImage(params.project, `assert/stage/${stageName}/${stageLabel}.jpg`));

    // 图像2+：登场角色外观图
    for (const character of characters) {
      imgs.push(await loadAssertImage(params.project, `assert/character/${character}/appearance.jpg`));
    }

    return {
      desc: prompt,
      imgs,
      seed: params.vars.seed,
    };
  },
}));
