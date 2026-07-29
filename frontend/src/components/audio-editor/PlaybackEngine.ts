/**
 * 音频回放引擎。
 * 使用 Web Audio API 根据编辑状态在内存中混合各音频片段进行预览。
 * 支持播放、暂停、恢复和 seek 到指定时间点。
 */

import type { AudioClipState, PlayState } from './types'

export interface PlaybackClip {
  state: AudioClipState
  buffer: AudioBuffer
}

export class PlaybackEngine {
  private audioCtx: AudioContext | null = null
  private gainNode: GainNode | null = null
  private _state: PlayState = 'idle'
  /** AudioContext 创建时的时间戳（用于计算 elapsed） */
  private _startTime = 0
  /** 暂停时记录的位置（秒） */
  private _pauseOffset = 0
  private _duration = 0
  /** 保存的 clips，用于恢复/seek 时重建 */
  private _savedClips: PlaybackClip[] = []
  private _onStateChange: ((state: PlayState) => void) | null = null
  private _onTimeUpdate: ((time: number) => void) | null = null
  private _rafId = 0
  private sourceNodes: AudioBufferSourceNode[] = []

  get state(): PlayState {
    return this._state
  }

  get duration(): number {
    return this._duration
  }

  set onStateChange(fn: ((state: PlayState) => void) | null) {
    this._onStateChange = fn
  }

  set onTimeUpdate(fn: ((time: number) => void) | null) {
    this._onTimeUpdate = fn
  }

  private setState(s: PlayState) {
    this._state = s
    this._onStateChange?.(s)
  }

  /**
   * 计算各片段的总时间轴长度（最大结束时间）。
   */
  static computeDuration(clips: AudioClipState[]): number {
    let maxEnd = 0
    for (const c of clips) {
      const end = c.startOffset + (c.duration - c.trimStart - c.trimEnd)
      if (end > maxEnd) maxEnd = end
    }
    return maxEnd
  }

  /**
   * 开始播放（从指定时间点或开头）。
   * @param clips 音频片段列表
   * @param fromTime 时间轴起始位置（秒），默认 0
   */
  async play(clips: PlaybackClip[], fromTime = 0): Promise<void> {
    this.stopSources()
    this.audioCtx?.close().catch(() => {})
    cancelAnimationFrame(this._rafId)
    this._savedClips = clips
    this._duration = PlaybackEngine.computeDuration(clips.map(c => c.state))
    this._pauseOffset = fromTime
    this._startTime = 0

    if (fromTime >= this._duration) {
      this.setState('idle')
      return
    }

    this.audioCtx = new AudioContext()
    this.gainNode = this.audioCtx.createGain()
    this.gainNode.connect(this.audioCtx.destination)

    const now = this.audioCtx.currentTime

    for (const { state, buffer } of clips) {
      const trimStart = state.trimStart || 0
      const trimEnd = state.trimEnd || 0
      const clipTotal = buffer.duration - trimStart - trimEnd // 裁剪后实际时长
      if (clipTotal <= 0) continue

      const clipStartOnTimeline = state.startOffset
      const clipEndOnTimeline = clipStartOnTimeline + clipTotal

      // 如果 fromTime 在这个片段的范围之外，跳过
      if (fromTime >= clipEndOnTimeline) continue

      let offsetInClip: number
      let scheduleDelay: number

      if (fromTime < clipStartOnTimeline) {
        // 片段尚未开始，将来再播放
        offsetInClip = 0
        scheduleDelay = clipStartOnTimeline - fromTime
      } else {
        // 片段正在播放中，需要从中间开始
        offsetInClip = fromTime - clipStartOnTimeline
        scheduleDelay = 0
      }

      const playDuration = clipTotal - offsetInClip
      if (playDuration <= 0) continue

      const source = this.audioCtx.createBufferSource()
      source.buffer = buffer
      source.loop = false

      const gain = this.audioCtx.createGain()
      source.connect(gain)
      gain.connect(this.gainNode!)

      const startAt = now + scheduleDelay
      source.start(startAt, trimStart + offsetInClip, playDuration)

      this.sourceNodes.push(source)
    }

    this._startTime = now - fromTime  // 使得 getCurrentTime = now - _startTime = fromTime
    this.setState('playing')
    this.startTimeUpdateLoop()
  }

  /**
   * 暂停播放。
   */
  pause(): void {
    if (this._state !== 'playing') return
    this._pauseOffset = this.getCurrentTime()
    this.stopSources()
    this.setState('paused')
    cancelAnimationFrame(this._rafId)
  }

  /**
   * 恢复播放。
   * @param clips 可选，最新的片段列表（拖拽后 clips 可能已变化）
   */
  resume(clips?: PlaybackClip[]): void {
    if (this._state !== 'paused') return
    if (this._pauseOffset >= this._duration) {
      this.stop()
      return
    }
    // 用最新的 clips 从暂停位置重新开始
    const useClips = clips ?? this._savedClips
    this.play(useClips, this._pauseOffset)
  }

  /**
   * 切换播放/暂停。
   * @param clips 音频片段列表
   */
  togglePlay(clips: PlaybackClip[]): void {
    if (this._state === 'playing') {
      this.pause()
    } else if (this._state === 'paused') {
      this.resume(clips)
    } else {
      // idle：从 _pauseOffset 处开始（若之前 seek 过）
      this.play(clips, this._pauseOffset)
    }
  }

  /**
   * 停止播放，重置状态。
   * @param resetPosition 是否重置播放位置到 0（默认 true）
   */
  stop(resetPosition = true): void {
    this.stopSources()
    this.audioCtx?.close().catch(() => {})
    this.audioCtx = null
    if (resetPosition) {
      this._pauseOffset = 0
    }
    this._duration = 0
    cancelAnimationFrame(this._rafId)
    this.setState('idle')
  }

  /**
   * 获取当前播放位置（秒）。
   */
  getCurrentTime(): number {
    if (this._state === 'playing' && this.audioCtx) {
      return this.audioCtx.currentTime - this._startTime
    }
    return this._pauseOffset
  }

  /**
   * 跳转到指定时间点播放（若正在播放则从该点继续，否则记录位置供下次播放）。
   * @param time 目标时间（秒）
   * @param clips 可选，最新的片段列表（playing 状态下 seek 时需要）
   */
  seek(time: number, clips?: PlaybackClip[]): void {
    // 若 duration 未知（idle 状态），根据 clips 计算
    if (this._duration <= 0 && clips && clips.length > 0) {
      this._duration = PlaybackEngine.computeDuration(clips.map(c => c.state))
    }
    const clamped = Math.max(0, Math.min(time, this._duration))
    if (this._state === 'playing') {
      // 使用传入的最新 clips，或回退到保存的
      const useClips = clips ?? this._savedClips
      this.play(useClips, clamped)
    } else {
      // paused / idle 均记录位置
      this._pauseOffset = clamped
      this._onTimeUpdate?.(clamped)
    }
  }

  /**
   * 渲染帧循环，上报当前时间。
   */
  private startTimeUpdateLoop = (): void => {
    const tick = () => {
      if (this._state === 'playing') {
        this._onTimeUpdate?.(this.getCurrentTime())
        if (this.getCurrentTime() >= this._duration) {
          this.stop()
          return
        }
        this._rafId = requestAnimationFrame(tick)
      }
    }
    this._rafId = requestAnimationFrame(tick)
  }

  private stopSources(): void {
    for (const src of this.sourceNodes) {
      try { src.stop() } catch { /* 已停止 */ }
      try { src.disconnect() } catch { /* 已断开 */ }
    }
    this.sourceNodes = []
  }


}
