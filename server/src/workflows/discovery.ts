import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  CharacterAppearanceVars,
  CharacterVoiceVars,
  SceneStageImageVars,
  SceneTtsVars,
  StageImageVars,
  VideoGenerateVars,
  WorkflowVarsBase,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESIGN_DIR = path.resolve(__dirname, '../../../design');

export interface DiscoveredTask {
  workflowId: string;
  impl: string;
  vars: WorkflowVarsBase & Record<string, string>;
  promptPaths: string[];
  outputPath: string;
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
 * @returns an array of discovered tasks
 */
export async function discoverTasks(
  project: string,
  assetTypes: string[],
  overwrite: boolean,
): Promise<DiscoveredTask[]> {
  const tasks: DiscoveredTask[] = [];
  const projectDir = path.resolve(DESIGN_DIR, project);
  const promptDir = path.join(projectDir, 'prompt');

  // Guard: ensure the project directory exists
  try {
    await fs.access(projectDir);
  } catch {
    return tasks;
  }

  /**
   * Check whether an output file should be skipped.
   * outputRelPath is a project-relative path like "assert/character/xxx/appearance.jpg".
   */
  async function shouldSkipOutput(outputRelPath: string): Promise<boolean> {
    if (overwrite) return false;
    const fullPath = path.resolve(projectDir, outputRelPath);
    // Prevent path traversal
    const rel = path.relative(projectDir, fullPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return true;
    return await fileExists(fullPath);
  }

  for (const assetType of assetTypes) {
    switch (assetType) {
      // ── Character Appearance ──────────────────────────────────────
      case 'character-appearance': {
        const charDir = path.join(promptDir, 'character');
        try {
          const entries = await fs.readdir(charDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const name = entry.name;
            const outputPath = `assert/character/${name}/appearance.jpg`;
            if (await shouldSkipOutput(outputPath)) continue;
            tasks.push({
              workflowId: 'character-appearance',
              impl: 'default',
              vars: { name } satisfies CharacterAppearanceVars,
              promptPaths: [`prompt/character/${name}/appearance.md`],
              outputPath,
            });
          }
        } catch {
          // prompt/character/ doesn't exist — skip this asset type
        }
        break;
      }

      // ── Character Voice ───────────────────────────────────────────
      case 'character-voice': {
        const charDir = path.join(promptDir, 'character');
        try {
          const entries = await fs.readdir(charDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const name = entry.name;
            const outputPath = `assert/character/${name}/voice.flac`;
            if (await shouldSkipOutput(outputPath)) continue;
            tasks.push({
              workflowId: 'character-voice',
              impl: 'default',
              vars: { name } satisfies CharacterVoiceVars,
              promptPaths: [`prompt/character/${name}/voice.md`],
              outputPath,
            });
          }
        } catch {
          // prompt/character/ doesn't exist
        }
        break;
      }

      // ── Stage Image ───────────────────────────────────────────────
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
              tasks.push({
                workflowId: 'stage-image',
                impl: 'default',
                vars: { name: stageName, label } satisfies StageImageVars,
                promptPaths: [`prompt/stage/${stageName}/${label}.md`],
                outputPath,
              });
            }
          }
        } catch {
          // prompt/stage/ doesn't exist
        }
        break;
      }

      // ── Scene-level asset types (shared iteration) ────────────────
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
                // stage.json 可能包含多个分镜场景，每个 index 单独生成一张图
                const stageJsonPath = path.join(episodePath, shot, 'stage.json');
                try {
                  const stageContent = await fs.readFile(stageJsonPath, 'utf-8');
                  const stages = JSON.parse(stageContent) as unknown;
                  if (!Array.isArray(stages)) continue;
                  for (let index = 0; index < stages.length; index++) {
                    const outputPath = `assert/scene/${episode}/${shot}/stage/${index}.jpg`;
                    if (await shouldSkipOutput(outputPath)) continue;
                    tasks.push({
                      workflowId: 'scene-stage-image',
                      impl: 'default',
                      vars: { episode, shot, index: String(index) } satisfies SceneStageImageVars,
                      promptPaths: [
                        `prompt/scene/${episode}/${shot}/overview.json`,
                        `prompt/scene/${episode}/${shot}/stage.json`,
                      ],
                      outputPath,
                    });
                  }
                } catch {
                  // stage.json missing or invalid — skip this shot
                }
              } else if (assetType === 'video-generate') {
                const outputPath = `assert/scene/${episode}/${shot}/video.mp4`;
                if (await shouldSkipOutput(outputPath)) continue;
                tasks.push({
                  workflowId: 'video-generate',
                  impl: 'default',
                  vars: { episode, shot } satisfies VideoGenerateVars,
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
                    // 引擎会再注入 character/text/voiceDesc/emotion，并强制规范 outputPath
                    const outputPath = `assert/scene/${episode}/${shot}/voice/${index}-${character}.flac`;
                    if (await shouldSkipOutput(outputPath)) continue;
                    tasks.push({
                      workflowId: 'scene-tts',
                      impl: 'default',
                      vars: {
                        episode,
                        shot,
                        index: String(index),
                        character,
                      } satisfies SceneTtsVars,
                      promptPaths: [
                        `prompt/scene/${episode}/${shot}/script.json`,
                        `prompt/character/${character}/voice.md`,
                      ],
                      outputPath,
                    });
                  }
                } catch {
                  // script.json missing or invalid — skip this shot
                }
              }
            }
          }
        } catch {
          // prompt/scene/ doesn't exist
        }
        break;
      }
    }
  }

  return tasks;
}
