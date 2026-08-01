import fs from 'fs/promises';
import path from 'path';
import { pathExists, resolveProjectPath } from './paths.js';
import Ffmpeg from 'fluent-ffmpeg';

interface AudioClipSpec {
  index: number
  角色名: string
  startOffset: number
  trimStart: number
  trimEnd: number
  duration?: number
}

interface AudioEditProject {
  version: number
  tracks: AudioClipSpec[]
}

/**
 * 获取音频文件时长（秒）。
 */
function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    Ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(data.format.duration ?? 0);
    });
  });
}

/**
 * 音频合并。
 *
 * 步骤：
 * 1. 对每段语音，用 ffmpeg 裁剪（atrim）并定位（adelay 添加开头静音）
 * 2. 用 amix 混合所有轨道
 * 3. 输出 flac
 */
export async function mergeSceneAudio(
  project: string,
  episode: string,
  shot: string,
): Promise<string> {
  // 1) 读取编辑状态
  const editPath = resolveProjectPath(
    project, `prompt/scene/${episode}/${shot}/audio-edit.json`,
  );
  let editRaw: string;
  try {
    editRaw = await fs.readFile(editPath, 'utf-8');
  } catch {
    throw Object.assign(new Error('audio-edit.json 不存在'), { code: 'NOT_FOUND' });
  }
  const edit: AudioEditProject = JSON.parse(editRaw);
  if (!edit.tracks?.length) {
    throw Object.assign(new Error('没有待合并的音频轨道'), { code: 'EMPTY' });
  }

  // 2) 检查语音文件，获取时长
  const voiceDir = resolveProjectPath(project, `assert/scene/${episode}/${shot}/voice`);
  const tracks: (AudioClipSpec & { filePath: string; duration: number })[] = [];
  for (const t of edit.tracks) {
    const filePath = path.join(voiceDir, `${t.index}-${t.角色名}.flac`);
    if (!(await pathExists(filePath))) continue;
    let duration = t.duration;
    if (!duration) {
      try { duration = await getAudioDuration(filePath); } catch { continue; }
    }
    tracks.push({ ...t, filePath, duration });
  }
  if (!tracks.length) {
    throw Object.assign(new Error('没有可用的语音文件'), { code: 'NOT_FOUND' });
  }

  // 3) 准备输出目录
  const outDir = resolveProjectPath(project, `assert/scene/${episode}/${shot}/audio`);
  await fs.mkdir(outDir, { recursive: true });
  const outputPath = path.join(outDir, 'merged.flac');

  // 4) 用 ffmpeg filter_complex 执行混合
  await new Promise<void>((resolve, reject) => {
    const command = Ffmpeg();

    // 添加所有语音文件作为输入
    for (const t of tracks) {
      command.input(t.filePath);
    }

    // 构建 filter_complex
    const inputLabels: string[] = [];
    const filterParts: string[] = [];

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const inLabel = `[${i}:a]`;
      const outLabel = `[p${i}]`;

      const filters: string[] = [];

      // atrim：裁剪起止
      if (t.trimStart > 0 || t.trimEnd > 0) {
        const actualEnd = t.duration - t.trimEnd;
        const parts: string[] = [];
        if (t.trimStart > 0) parts.push(`start=${t.trimStart}`);
        if (t.trimEnd > 0) parts.push(`end=${actualEnd}`);
        if (parts.length) {
          filters.push(`atrim=${parts.join(':')}`);
          filters.push('asetpts=PTS-STARTPTS');
        }
      }

      // adelay：在开头添加静音
      if (t.startOffset > 0) {
        const delayMs = Math.round(t.startOffset * 1000);
        filters.push(`adelay=${delayMs}|${delayMs}`);
      }

      if (filters.length > 0) {
        filterParts.push(`${inLabel}${filters.join(',')}${outLabel}`);
        inputLabels.push(outLabel);
      } else {
        inputLabels.push(inLabel);
      }
    }

    if (inputLabels.length === 0) {
      reject(new Error('没有可处理的音频'));
      return;
    }

    // amix：混合所有轨道
    // 使用 duration=longest，保证延迟靠后的轨道（startOffset 较大）不被截断
    const mixOut = '[mix]';
    filterParts.push(
      `${inputLabels.join('')}amix=inputs=${inputLabels.length}:duration=longest:dropout_transition=0${mixOut}`,
    );

    command
      .complexFilter(filterParts)
      .audioCodec('flac')
      .audioChannels(1)
      .audioFrequency(44100)
      .noVideo()
      .outputOptions(['-map', mixOut])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });

  return outputPath;
}

/**
 * 删除分镜已合并的音频文件（merged.flac）。
 *
 * 当分镜台词发生新增/修改/删除/排序，或语音文件变化后，
 * 已合并音频与最新台词不再匹配，需要删除以保证后续重新合并。
 * 文件不存在时静默成功（幂等操作）。
 *
 * @param project 项目名
 * @param episode 集数
 * @param shot 分镜号
 * @returns 是否实际删除了文件
 */
export async function deleteMergedAudio(
  project: string,
  episode: string,
  shot: string,
): Promise<boolean> {
  const mergedPath = resolveProjectPath(
    project,
    `assert/scene/${episode}/${shot}/audio/merged.flac`,
  );
  if (!(await pathExists(mergedPath))) return false;
  await fs.unlink(mergedPath);
  return true;
}
