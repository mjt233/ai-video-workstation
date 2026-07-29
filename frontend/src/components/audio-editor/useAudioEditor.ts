/**
 * 音频编辑状态管理 composable。
 * 管理波形数据加载、编辑状态的 CRUD、保存/加载。
 */

import { ref, computed } from 'vue'
import { readFs, writeFs, existsFs } from '../../api/client'
import { extractWaveform } from './waveform'
import { PlaybackEngine, type PlaybackClip } from './PlaybackEngine'
import type { AudioClipState, AudioEditProject, WaveformData, PlayState } from './types'

export function useAudioEditor(project: string, episode: string, shot: string) {
  const clips = ref<AudioClipState[]>([])
  const waveforms = ref<Map<number, WaveformData>>(new Map())
  const audioBuffers = ref<Map<number, AudioBuffer>>(new Map())
  const loading = ref(false)
  const saving = ref(false)
  const playState = ref<PlayState>('idle')
  const currentTime = ref(0)
  const zoom = ref(80) // 像素/秒
  const hasEdit = ref(false)

  const engine = new PlaybackEngine()

  engine.onStateChange = (s) => {
    playState.value = s
  }
  engine.onTimeUpdate = (t) => {
    currentTime.value = t
  }

  const totalDuration = computed(() => {
    return PlaybackEngine.computeDuration(clips.value)
  })

  /**
   * 加载该分镜的所有台词音频及已有编辑状态。
   */
  async function load(): Promise<void> {
    loading.value = true
    try {
      // 1) 读 script.json
      const scriptRaw = await readFs(project, `prompt/scene/${episode}/${shot}/script.json`)
      let script: { 角色名: string; 台词: string }[] = []
      if (typeof scriptRaw === 'string') {
        script = JSON.parse(scriptRaw || '[]')
      } else if (Array.isArray(scriptRaw)) {
        script = scriptRaw as { 角色名: string; 台词: string }[]
      }

      if (!script.length) {
        clips.value = []
        loading.value = false
        return
      }

      // 2) 检查每个台词是否有语音文件
      const voiceChecks = await Promise.all(
        script.map((entry, i) =>
          existsFs(project, `assert/scene/${episode}/${shot}/voice/${i}-${entry.角色名}.flac`),
        ),
      )

      const allHaveVoice = voiceChecks.every(Boolean)
      if (!allHaveVoice) {
        clips.value = []
        loading.value = false
        return
      }

      // 3) 加载已有编辑状态
      let savedProject: AudioEditProject | null = null
      try {
        const savedRaw = await readFs(project, `prompt/scene/${episode}/${shot}/audio-edit.json`)
        if (typeof savedRaw === 'string' && savedRaw.trim()) {
          savedProject = JSON.parse(savedRaw) as AudioEditProject
        }
      } catch {
        // 没有保存的编辑状态
      }

      // 4) 构建 clips 与波形数据
      const newClips: AudioClipState[] = []
      const newWaveforms = new Map<number, WaveformData>()
      const newBuffers = new Map<number, AudioBuffer>()
      let cursor = 0
      for (let i = 0; i < script.length; i++) {
        const entry = script[i]
        const existing = savedProject?.tracks.find(t => t.index === i)
        const url = `/api/fs/${project}/assert/scene/${episode}/${shot}/voice/${i}-${entry.角色名}.flac`
        let duration = 0
        try {
          const wf = await extractWaveform(url, 50)
          newWaveforms.set(i, wf)
          duration = wf.duration
        } catch {
          duration = 0
        }

        // 加载 AudioBuffer 供播放
        try {
          const resp = await fetch(url)
          const ab = await resp.arrayBuffer()
          const ctx = new AudioContext()
          const buf = await ctx.decodeAudioData(ab)
          ctx.close()
          newBuffers.set(i, buf)
        } catch {
          // 无法解码
        }

        newClips.push({
          index: i,
          角色名: entry.角色名,
          label: (entry.台词 ?? '').slice(0, 12) + ((entry.台词 ?? '').length > 12 ? '...' : ''),
          duration,
          startOffset: existing?.startOffset ?? cursor,
          trimStart: existing?.trimStart ?? 0,
          trimEnd: existing?.trimEnd ?? 0,
        })
        cursor += duration
      }

      // 一次性替换 ref 值以触发响应式更新
      waveforms.value = newWaveforms
      audioBuffers.value = newBuffers

      clips.value = newClips
      hasEdit.value = !!savedProject
    } catch (e) {
      console.error('加载音频编辑失败', e)
      clips.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * 更新某个 clip 的属性。
   */
  function updateClip(index: number, partial: Partial<AudioClipState>): void {
    const idx = clips.value.findIndex(c => c.index === index)
    if (idx < 0) return
    clips.value[idx] = { ...clips.value[idx], ...partial }
  }

  /**
   * 保存编辑状态到 JSON。
   */
  async function save(): Promise<void> {
    saving.value = true
    try {
      const editProject: AudioEditProject = {
        version: 1,
        tracks: clips.value.map(c => ({
          index: c.index,
          角色名: c.角色名,
          label: c.label,
          duration: c.duration,
          startOffset: c.startOffset,
          trimStart: c.trimStart,
          trimEnd: c.trimEnd,
        })),
      }
      await writeFs(
        project,
        `prompt/scene/${episode}/${shot}/audio-edit.json`,
        JSON.stringify(editProject, null, 2),
      )
      hasEdit.value = true
    } finally {
      saving.value = false
    }
  }

  /**
   * 播放/暂停切换。
   */
  async function togglePlay(): Promise<void> {
    if (playState.value === 'playing') {
      engine.pause()
      return
    }
    if (playState.value === 'paused') {
      engine.resume()
      return
    }
    // idle → 重新播放
    const playableClips: PlaybackClip[] = []
    for (const c of clips.value) {
      const buf = audioBuffers.value.get(c.index)
      if (buf) {
        playableClips.push({ state: c, buffer: buf })
      }
    }
    if (playableClips.length === 0) return
    await engine.play(playableClips)
  }

  /**
   * 停止播放。
   */
  function stopPlay(): void {
    engine.stop()
  }

  /**
   * 设置缩放。
   */
  function setZoom(z: number): void {
    zoom.value = Math.max(10, Math.min(500, z))
  }

  return {
    clips,
    waveforms,
    loading,
    saving,
    playState,
    currentTime,
    zoom,
    hasEdit,
    totalDuration,
    load,
    updateClip,
    save,
    togglePlay,
    stopPlay,
    setZoom,
  }
}
