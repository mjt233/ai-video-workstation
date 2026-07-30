/**
 * 音频波形数据提取工具。
 * 使用 Web Audio API 解码音频文件并降采样为峰值数据，
 * 用于 Canvas 波形绘制。
 */

import type { WaveformData } from './types'

/**
 * 从音频 URL 提取波形数据。
 * 每秒钟生成 `peaksPerSecond` 个峰值点。
 */
export async function extractWaveform(
  url: string,
  peaksPerSecond = 100,
): Promise<WaveformData> {
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()
  const audioCtx = new AudioContext()
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
  audioCtx.close()

  const channelData = audioBuffer.getChannelData(0) // 只用左声道
  const duration = audioBuffer.duration
  const totalSamples = channelData.length

  // 每段窗口的样本数
  const windowSize = Math.max(1, Math.floor(totalSamples / (duration * peaksPerSecond)))
  const peakCount = Math.ceil(totalSamples / windowSize)
  const peaks = new Float32Array(peakCount)

  for (let i = 0; i < peakCount; i++) {
    const start = i * windowSize
    const end = Math.min(start + windowSize, totalSamples)
    let max = 0
    for (let j = start; j < end; j++) {
      const abs = Math.abs(channelData[j])
      if (abs > max) max = abs
    }
    peaks[i] = max
  }

  return { peaks, sampleRate: peaksPerSecond, duration }
}

/**
 * 将波形数据绘制到 Canvas。
 * @param canvas 目标 canvas 元素
 * @param waveform 波形数据
 * @param color 波形颜色
 * @param zoom 缩放比例（像素/秒）
 * @param scrollOffset 水平滚动偏移（像素）
 * @param width canvas 显示宽度
 * @param height canvas 显示高度
 */
export function drawWaveform(
  canvas: HTMLCanvasElement,
  waveform: WaveformData,
  color: string,
  zoom: number,
  scrollOffset: number,
  width: number,
  height: number,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  canvas.width = width
  canvas.height = height
  ctx.clearRect(0, 0, width, height)

  const totalPixels = waveform.duration * zoom
  const visibleStartPx = scrollOffset
  const visibleEndPx = scrollOffset + width

  const peaksPerPixel = waveform.peaks.length / totalPixels
  const startPeak = Math.max(0, Math.floor(visibleStartPx * peaksPerPixel))
  const endPeak = Math.min(waveform.peaks.length, Math.ceil(visibleEndPx * peaksPerPixel))

  const centerY = height / 2

  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = 1

  for (let i = startPeak; i < endPeak; i++) {
    const px = (i / peaksPerPixel) - scrollOffset
    if (px < 0 || px > width) continue

    const amplitude = waveform.peaks[i] * (height * 0.45)
    ctx.fillRect(px, centerY - amplitude, 1, amplitude * 2)
  }
}

/**
 * 计算裁剪后的显示时长。
 */
export function clipVisibleDuration(clip: {
  duration: number
  trimStart: number
  trimEnd: number
}): number {
  return Math.max(0, clip.duration - clip.trimStart - clip.trimEnd)
}
