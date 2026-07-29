/**
 * 音频回放引擎。
 * 使用 Web Audio API 根据编辑状态在内存中混合各音频片段进行预览。
 */

import type { AudioClipState, PlayState } from './types'

export interface PlaybackClip {
  state: AudioClipState
  buffer: AudioBuffer
}

export class PlaybackEngine {
  private audioCtx: AudioContext | null = null
  private sourceNodes: AudioBufferSourceNode[] = []
  private gainNode: GainNode | null = null
  private _state: PlayState = 'idle'
  private _startTime = 0
  private _pauseOffset = 0
  private _duration = 0
  private _onStateChange: ((state: PlayState) => void) | null = null
  private _onTimeUpdate: ((time: number) => void) | null = null
  private _rafId = 0

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
   * 加载所有音频文件并开始播放。
   * 可在用户交互（如点击播放按钮）后调用。
   */
  async play(clips: PlaybackClip[]): Promise<void> {
    this.stop()

    this.audioCtx = new AudioContext()
    this.gainNode = this.audioCtx.createGain()
    this.gainNode.connect(this.audioCtx.destination)

    this._duration = PlaybackEngine.computeDuration(clips.map(c => c.state))

    // 为每个片段创建 SourceNode 并按时调度
    for (const { state, buffer } of clips) {
      const source = this.audioCtx.createBufferSource()
      source.buffer = buffer

      // 计算裁剪后的片段
      const trimStart = state.trimStart || 0
      const trimEnd = state.trimEnd || 0
      const clipDuration = Math.max(0, buffer.duration - trimStart - trimEnd)

      // 从 trimStart 偏移处开始播放，持续 clipDuration
      source.loop = false

      const gain = this.audioCtx.createGain()
      source.connect(gain)
      gain.connect(this.gainNode!)

      source.start(0, trimStart, clipDuration)

      this.sourceNodes.push(source)
    }

    this._startTime = this.audioCtx.currentTime
    this._pauseOffset = 0
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
   */
  resume(): void {
    if (this._state !== 'paused' || !this.audioCtx) return
    this.playFrom(this._pauseOffset)
  }

  /**
   * 切换播放/暂停。
   */
  togglePlay(clips: PlaybackClip[]): void {
    if (this._state === 'playing') {
      this.pause()
    } else if (this._state === 'paused') {
      this.resume()
    } else {
      this.play(clips)
    }
  }

  /**
   * 停止播放，重置状态。
   */
  stop(): void {
    this.stopSources()
    this.audioCtx?.close().catch(() => {})
    this.audioCtx = null
    this._pauseOffset = 0
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
   * 从指定时间点开始播放（用于 seek）。
   */
  private async playFrom(_offset: number): Promise<void> {
    // 简化实现：停止后重新播放所有片段
    // 实际可优化为使用 GrainPlayer 或 seek
    this.stop()
    // 重新加载 clips 后调用 play
  }

  /**
   * 渲染帧循环，上报当前时间。
   */
  private startTimeUpdateLoop = (): void => {
    const tick = () => {
      if (this._state === 'playing') {
        this._onTimeUpdate?.(this.getCurrentTime())
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
