import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  ImageEditVars,
  ImageToVideoVars,
  TextToImageVars,
  TtsVoiceDesignVars,
  WorkflowVarsBase,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESIGN_DIR = path.resolve(__dirname, '../../../design');

/**
 * 批量发现得到的生成任务描述。
 *
 * workflowId 为工作流类型（text-to-image / image-edit / ...），
 * assetType 为资产用途（character-appearance / stage-image / ...），便于前端展示。
 */
export interface DiscoveredTask {
  /** 工作流类型 ID */
  workflowId: string;
  /** 实现标识（可缺省：批量创建端按资产类型解析，缺省时回退到该类型第一个实现） */
  impl?: string;
  /** 业务变量 */
  vars: WorkflowVarsBase & Record<string, string>;
  /** 相关 prompt 路径（展示用） */
  promptPaths: string[];
  /** 输出 assert 路径 */
  outputPath: string;
  /**
   * 资产用途类型（批量选择用，与前端 assetTypes 对齐）。
   * 例：character-appearance / character-voice / stage-image / scene-stage-image / scene-tts / video-generate / variant-edit
   */
  assetType?: string;
}

/**
 * Check whether a file exists at the given path.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Discover all generation tasks for a project based on selected asset types.
 *
 * @param project   – project name (subdirectory under design/)
 * @param assetTypes – array of asset type identifiers to discover
 * @param overwrite  – if true, include tasks even if the output file already exists
 * @param implByAssetType – 按资产类型覆盖工作流实现（前端勾选资产类型后手动选择，默认取第一个实现）
 * @returns an array of discovered tasks
 */
export async function discoverTasks(
  project: string,
  assetTypes: string[],
  overwrite: boolean,
  implByAssetType?: Record<string, string>,
): Promise<DiscoveredTask[]> {
  const tasks: DiscoveredTask[] = [];
  const projectDir = path.resolve(DESIGN_DIR, project);
  const promptDir = path.join(projectDir, 'prompt');

  try {
    await fs.access(projectDir);
  } catch {
    return tasks;
  }

  async function shouldSkipOutput(outputRelPath: string): Promise<boolean> {
    if (overwrite) return false;
    const fullPath = path.resolve(projectDir, outputRelPath);
    const rel = path.relative(projectDir, fullPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return true;
    return await fileExists(fullPath);
  }

  for (const assetType of assetTypes) {
    switch (assetType) {
      case 'character-appearance': {
        const charDir = path.join(promptDir, 'character');
        try {
          const entries = await fs.readdir(charDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const name = entry.name;
            const outputPath = `assert/character/${name}/appearance.jpg`;
            if (await shouldSkipOutput(outputPath)) continue;
            const promptPath = `prompt/character/${name}/appearance.md`;
            tasks.push({
              workflowId: 'text-to-image',
              assetType,
              vars: {
                promptPath,
                width: '1280',
                height: '720',
                purpose: 'character-appearance',
                name,
              } satisfies TextToImageVars,
              promptPaths: [promptPath],
              outputPath,
            });
          }
        } catch {
          // skip
        }
        break;
      }

      case 'character-voice': {
        const charDir = path.join(promptDir, 'character');
        try {
          const entries = await fs.readdir(charDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const name = entry.name;
            const outputPath = `assert/character/${name}/voice.flac`;
            if (await shouldSkipOutput(outputPath)) continue;
            const voicePath = `prompt/character/${name}/voice.md`;
            let voiceDesc = '';
            try {
              voiceDesc = (await fs.readFile(path.join(projectDir, voicePath), 'utf-8')).trim();
            } catch {
              continue;
            }
            if (!voiceDesc) continue;
            tasks.push({
              workflowId: 'tts-voice-design',
              assetType,
              vars: {
                prompt: voiceDesc,
                text: `你好，我叫${name}`,
                purpose: 'character-voice',
                character: name,
                name,
              } satisfies TtsVoiceDesignVars & { name: string },
              promptPaths: [voicePath],
              outputPath,
            });
          }
        } catch {
          // skip
        }
        break;
      }

      case 'stage-image': {
        const stageDir = path.join(promptDir, 'stage');
        try {
          const stageEntries = await fs.readdir(stageDir, { withFileTypes: true });
          for (const stageEntry of stageEntries) {
            if (!stageEntry.isDirectory()) continue;
            const stageName = stageEntry.name;
            const stagePath = path.join(stageDir, stageName);
            const files = await fs.readdir(stagePath);
            for (const file of files) {
              if (!file.endsWith('.md')) continue;
              const label = file.slice(0, -'.md'.length);
              const outputPath = `assert/stage/${stageName}/${label}.jpg`;
              if (await shouldSkipOutput(outputPath)) continue;
              const promptPath = `prompt/stage/${stageName}/${label}.md`;
              tasks.push({
                workflowId: 'text-to-image',
                assetType,
                vars: {
                  promptPath,
                  purpose: 'stage-image',
                  stageName,
                  label,
                  name: stageName,
                } satisfies TextToImageVars,
                promptPaths: [promptPath],
                outputPath,
              });
            }
          }
        } catch {
          // skip
        }
        break;
      }

      case 'variant-edit': {
        const charDir = path.join(promptDir, 'character');
        try {
          const entries = await fs.readdir(charDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const name = entry.name;
            const variantsDir = path.join(charDir, name, 'variants');
            let variantFiles: string[] = [];
            try {
              variantFiles = (await fs.readdir(variantsDir)).filter((f) => f.endsWith('.json'));
            } catch {
              continue;
            }
            for (const vf of variantFiles) {
              const variantId = vf.slice(0, -'.json'.length);
              let meta: { desc?: string; baseImage?: string };
              try {
                meta = JSON.parse(await fs.readFile(path.join(variantsDir, vf), 'utf-8')) as {
                  desc?: string;
                  baseImage?: string;
                };
              } catch {
                continue;
              }
              const desc = (meta.desc ?? '').trim();
              if (!desc) continue;
              const outputPath = `assert/character/${name}/variants/${variantId}.jpg`;
              if (await shouldSkipOutput(outputPath)) continue;
              const baseImage = (meta.baseImage ?? `assert/character/${name}/appearance.jpg`).trim();
              tasks.push({
                workflowId: 'image-edit',
                assetType,
                vars: {
                  prompt: desc,
                  imagePaths: JSON.stringify([baseImage]),
                  purpose: 'variant-edit',
                  variantKind: 'character',
                  variantOwner: name,
                  variantId,
                } satisfies ImageEditVars,
                promptPaths: [`prompt/character/${name}/variants/${variantId}.json`],
                outputPath,
              });
            }
          }
        } catch {
          // ignore
        }

        const stageDir = path.join(promptDir, 'stage');
        try {
          const stageEntries = await fs.readdir(stageDir, { withFileTypes: true });
          for (const stageEntry of stageEntries) {
            if (!stageEntry.isDirectory()) continue;
            const stageName = stageEntry.name;
            const variantsRoot = path.join(stageDir, stageName, 'variants');
            let baseLabels: string[] = [];
            try {
              baseLabels = (await fs.readdir(variantsRoot, { withFileTypes: true }))
                .filter((e) => e.isDirectory())
                .map((e) => e.name);
            } catch {
              continue;
            }
            for (const baseLabel of baseLabels) {
              const vDir = path.join(variantsRoot, baseLabel);
              let variantFiles: string[] = [];
              try {
                variantFiles = (await fs.readdir(vDir)).filter((f) => f.endsWith('.json'));
              } catch {
                continue;
              }
              for (const vf of variantFiles) {
                const variantId = vf.slice(0, -'.json'.length);
                let meta: { desc?: string; baseImage?: string };
                try {
                  meta = JSON.parse(await fs.readFile(path.join(vDir, vf), 'utf-8')) as {
                    desc?: string;
                    baseImage?: string;
                  };
                } catch {
                  continue;
                }
                const desc = (meta.desc ?? '').trim();
                if (!desc) continue;
                const outputPath = `assert/stage/${stageName}/variants/${baseLabel}/${variantId}.jpg`;
                if (await shouldSkipOutput(outputPath)) continue;
                const baseImage = (
                  meta.baseImage ?? `assert/stage/${stageName}/${baseLabel}.jpg`
                ).trim();
                tasks.push({
                  workflowId: 'image-edit',
                  assetType,
                  vars: {
                    prompt: desc,
                    imagePaths: JSON.stringify([baseImage]),
                    purpose: 'variant-edit',
                    variantKind: 'stage',
                    variantOwner: stageName,
                    baseLabel,
                    variantId,
                  } satisfies ImageEditVars,
                  promptPaths: [`prompt/stage/${stageName}/variants/${baseLabel}/${variantId}.json`],
                  outputPath,
                });
              }
            }
          }
        } catch {
          // ignore
        }
        break;
      }

      case 'scene-stage-image':
      case 'scene-tts':
      case 'video-generate': {
        const sceneDir = path.join(promptDir, 'scene');
        try {
          const episodeEntries = await fs.readdir(sceneDir, { withFileTypes: true });
          for (const episodeEntry of episodeEntries) {
            if (!episodeEntry.isDirectory()) continue;
            const episode = episodeEntry.name;
            const episodePath = path.join(sceneDir, episode);
            const shotEntries = await fs.readdir(episodePath, { withFileTypes: true });
            for (const shotEntry of shotEntries) {
              if (!shotEntry.isDirectory()) continue;
              const shot = shotEntry.name;

              if (assetType === 'scene-stage-image') {
                const stageJsonPath = path.join(episodePath, shot, 'stage.json');
                try {
                  const stageContent = await fs.readFile(stageJsonPath, 'utf-8');
                  const stages = JSON.parse(stageContent) as unknown;
                  if (!Array.isArray(stages)) continue;
                  for (let index = 0; index < stages.length; index++) {
                    const outputPath = `assert/scene/${episode}/${shot}/stage/${index}.jpg`;
                    if (await shouldSkipOutput(outputPath)) continue;
                    tasks.push({
                      workflowId: 'image-edit',
                      assetType,
                      vars: {
                        prompt: '',
                        imagePaths: '[]',
                        purpose: 'scene-stage-image',
                        episode,
                        shot,
                        index: String(index),
                      } satisfies ImageEditVars,
                      promptPaths: [
                        `prompt/scene/${episode}/${shot}/overview.json`,
                        `prompt/scene/${episode}/${shot}/stage.json`,
                      ],
                      outputPath,
                    });
                  }
                } catch {
                  // skip
                }
              } else if (assetType === 'video-generate') {
                const outputPath = `assert/scene/${episode}/${shot}/video.mp4`;
                if (await shouldSkipOutput(outputPath)) continue;
                // 所有场景帧均被禁用时不生成视频任务（禁用的场景帧不参与视频生成）
                try {
                  const stageContent = await fs.readFile(
                    path.join(episodePath, shot, 'stage.json'),
                    'utf-8',
                  );
                  const stages = JSON.parse(stageContent) as Array<{ disabled?: unknown }>;
                  if (
                    Array.isArray(stages)
                    && stages.length > 0
                    && stages.every((s) => s?.disabled === true)
                  ) {
                    continue;
                  }
                } catch {
                  // stage.json 缺失或无效时交由任务执行阶段报错
                }
                tasks.push({
                  workflowId: 'image-to-video',
                  assetType,
                  vars: { episode, shot } satisfies ImageToVideoVars,
                  promptPaths: [`prompt/scene/${episode}/${shot}/prompt.md`],
                  outputPath,
                });
              } else if (assetType === 'scene-tts') {
                const scriptPath = path.join(episodePath, shot, 'script.json');
                try {
                  const scriptContent = await fs.readFile(scriptPath, 'utf-8');
                  const script = JSON.parse(scriptContent) as Array<{ 角色名: string; 台词: string; 情绪?: string }>;
                  if (!Array.isArray(script)) continue;
                  for (let index = 0; index < script.length; index++) {
                    const character = (script[index]?.角色名 ?? '').trim();
                    if (!character) continue;
                    const outputPath = `assert/scene/${episode}/${shot}/voice/${index}-${character}.flac`;
                    if (await shouldSkipOutput(outputPath)) continue;
                    tasks.push({
                      workflowId: 'tts-voice-design',
                      assetType,
                      vars: {
                        prompt: '',
                        text: '',
                        purpose: 'scene-tts',
                        episode,
                        shot,
                        index: String(index),
                        character,
                      } satisfies TtsVoiceDesignVars,
                      promptPaths: [
                        `prompt/scene/${episode}/${shot}/script.json`,
                        `prompt/character/${character}/voice.md`,
                      ],
                      outputPath,
                    });
                  }
                } catch {
                  // skip
                }
              }
            }
          }
        } catch {
          // skip
        }
        break;
      }
    }
  }

  // 按资产类型覆盖工作流实现（前端勾选资产类型后手动选择，默认取第一个实现）
  const implOverride = implByAssetType ?? {};
  for (const task of tasks) {
    const override = task.assetType ? implOverride[task.assetType] : undefined;
    if (override) task.impl = override;
  }

  return tasks;
}