/**
 * 视频导演台状态管理 composable。
 *
 * 负责维护导演台项目的完整编辑状态：图片轨与音频轨的素材块列表、视频时长、
 * 播放头时间、播放状态、缩放、选中项与剪贴板，并提供增删改、复制粘贴、
 * 移动/拉伸/裁剪等编辑操作。
 *
 * 所有会修改项目的编辑操作都会调用内部 `commit()`，把最新项目
 * （`toProject()` 的深拷贝，可直接落盘为 `director.json`）通过 `onChange`
 * 回调通知调用方；播放状态、选中与剪贴板等非项目状态变更不触发回调。
 *
 * 复用 audio-editor 的状态管理模式：由组件创建实例并持有，外部通过
 * `syncFromProject` 加载项目、通过返回值中的响应式状态驱动视图。
 */

import { ref, computed } from 'vue'
import {
  createDirectorProject,
  DEFAULT_IMAGE_CLIP_DURATION,
  type DirectorAudioClip,
  type DirectorImageClip,
  type DirectorProject,
} from './types'

/** 导演台播放状态：idle 未播放 / playing 播放中 / paused 已暂停 */
export type DirectorPlayState = 'idle' | 'playing' | 'paused'

/**
 * 将数值钳制到 [min, max] 区间。
 *
 * @param value 原始值
 * @param min 下界（含）
 * @param max 上界（含）
 * @returns 钳制后的值
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * 判断素材块是否为音频块。
 *
 * 依据音频块独有字段 `trimStart` 的存在性区分图片块与音频块。
 *
 * @param clip 待判断的素材块
 * @returns true 表示音频块
 */
function isAudioClip(clip: DirectorImageClip | DirectorAudioClip): clip is DirectorAudioClip {
  return 'trimStart' in clip
}

/**
 * 计算指定时刻应预览的图片路径（纯函数）。
 *
 * 规则：取最后一个 `startOffset <= t` 的图片块，返回其 `path`；
 * 无任何图片块或所有图片块都晚于 t 时返回 null。
 *
 * @param imageClips 图片轨素材块列表（无需排序）
 * @param t 当前时间（秒）
 * @returns 应预览的图片路径，或 null
 */
export function previewImageAt(imageClips: DirectorImageClip[], t: number): string | null {
  let hit: DirectorImageClip | null = null
  for (const clip of imageClips) {
    if (clip.startOffset <= t) hit = clip
  }
  return hit ? hit.path : null
}

/**
 * 计算复制粘贴时新块的起始偏移（纯函数）。
 *
 * 规则：新块落在被复制块 `startOffset + 1` 秒处，保证两块不重叠。
 *
 * @param clip 被复制的素材块（图片或音频）
 * @returns 粘贴后新块的 startOffset（秒）
 */
export function computePasteOffset(clip: DirectorImageClip | DirectorAudioClip): number {
  return clip.startOffset + 1
}

/**
 * 在既有图片块之间寻找不重叠的起始偏移（纯函数）。
 *
 * 图片轨不允许重叠：给定其他图片块的占用区间与轨道总时长，返回一个
 * 使长度为 `clipDuration` 的新块与所有既有块不重叠、且尽量接近 `desired`
 * 的起始偏移；轨道已满（所有空闲区间都放不下）时返回 null，调用方应
 * 放弃放置（不添加/不移动），避免产生重叠。
 *
 * @param others 其他图片块（仅读取 startOffset/duration）
 * @param totalDuration 轨道总时长（秒）
 * @param desired 期望的起始偏移（秒）
 * @param clipDuration 新块长度（秒）
 * @returns 满足不重叠约束的起始偏移；轨道已满时返回 null
 */
export function resolveImageStartOffset(
  others: Array<{ startOffset: number; duration: number }>,
  totalDuration: number,
  desired: number,
  clipDuration: number,
): number | null {
  const maxStart = Math.max(0, totalDuration - clipDuration)
  // 既有块的占用区间（按起点排序，合并重叠）
  const occ = others
    .map((o) => ({ s: o.startOffset, e: o.startOffset + o.duration }))
    .sort((a, b) => a.s - b.s)
  // 空闲区间（占用区间的补集）
  const gaps: Array<{ s: number; e: number }> = []
  let cursor = 0
  for (const o of occ) {
    if (o.s > cursor) gaps.push({ s: cursor, e: o.s })
    cursor = Math.max(cursor, o.e)
  }
  gaps.push({ s: cursor, e: Infinity })

  const target = clamp(desired, 0, maxStart)
  // 找到包含 target（或其后第一个）的空闲区间，在其中钳制
  for (const g of gaps) {
    if (g.e < target) continue
    const lo = Math.max(0, g.s)
    const hi = Math.min(g.e, totalDuration)
    const maxStartInGap = hi - clipDuration
    if (maxStartInGap >= lo) {
      return clamp(target, lo, maxStartInGap)
    }
  }
  // 所有空闲区间都放不下 → 轨道已满
  return null
}

/**
 * 将图片块映射为关键帧游标比值列表（纯函数）。
 *
 * 按 `startOffset` 升序排序后，逐块计算 `startOffset / duration` 并钳制到
 * [0, 1]；时长非正时（无有效视频长度）统一返回 0，避免除零产生 NaN/Infinity。
 *
 * @param imageClips 图片轨素材块列表（顺序无关，仅读取 startOffset）
 * @param duration 视频总时长（秒）
 * @returns 与排序后图片块一一对应的游标比值数组
 */
export function frameCursors(imageClips: DirectorImageClip[], duration: number): number[] {
  if (duration <= 0) return imageClips.map(() => 0)
  return [...imageClips]
    .sort((a, b) => a.startOffset - b.startOffset)
    .map((c) => clamp(c.startOffset / duration, 0, 1))
}

/** useVideoDirector 的可选配置项 */
export interface UseVideoDirectorOptions {
  /**
   * 项目内容变更回调：每次编辑操作（增删改/移动/拉伸/裁剪/粘贴等）后触发，
   * 参数为最新项目的深拷贝，可直接序列化保存为 director.json。
   */
  onChange?: (p: DirectorProject) => void
}

/**
 * 创建视频导演台状态管理器。
 *
 * 内部以 `project` ref 为唯一状态源，`imageClips`/`audioClips`/`duration`
 * 均为派生自它的 computed（对调用方同样是带 `.value` 的响应式引用）。
 *
 * @param options 配置项，目前仅含项目变更回调 onChange
 * @returns 状态与操作集合（详见各字段/方法注释）
 */
export function useVideoDirector(options: UseVideoDirectorOptions = {}) {
  const { onChange } = options

  /** 导演台项目（唯一状态源；图片块/音频块/时长均派生自此） */
  const project = ref<DirectorProject>(createDirectorProject())

  /** 图片轨素材块列表（派生自 project） */
  const imageClips = computed(() => project.value.imageClips)
  /** 音频轨素材块列表（派生自 project） */
  const audioClips = computed(() => project.value.audioClips)
  /** 视频总时长（秒，派生自 project） */
  const duration = computed(() => project.value.duration)

  /** 播放头当前时间（秒） */
  const currentTime = ref(0)
  /** 播放状态（idle/playing/paused） */
  const playState = ref<DirectorPlayState>('idle')
  /** 时间轴缩放（像素/秒，默认 80） */
  const zoom = ref(80)
  /** 当前选中素材块的 id（无选中时为 null） */
  const selectedId = ref<string | null>(null)
  /** 剪贴板：最近一次复制/剪切（仅复制）的素材块副本（图片或音频），无内容时为 null */
  const clipboard = ref<DirectorImageClip | DirectorAudioClip | null>(null)

  /**
   * 将内部状态序列化为项目对象。
   *
   * 素材块返回浅拷贝副本，防止调用方通过返回值意外污染内部状态。
   *
   * @returns 当前项目对象（含 version/规格/两条轨道列表）
   */
  function toProject(): DirectorProject {
    return {
      version: project.value.version,
      duration: project.value.duration,
      width: project.value.width,
      height: project.value.height,
      fps: project.value.fps,
      imageClips: project.value.imageClips.map((c) => ({ ...c })),
      audioClips: project.value.audioClips.map((c) => ({ ...c })),
    }
  }

  /**
   * 从外部项目同步内部状态。
   *
   * 深拷贝入参中的素材块列表（逐块浅拷贝），此后外部对原项目的修改
   * 不再影响内部状态；不触发 onChange 回调（属于加载而非用户编辑）。
   *
   * @param p 要同步的导演台项目
   */
  function syncFromProject(p: DirectorProject): void {
    project.value = {
      version: p.version,
      duration: p.duration,
      width: p.width,
      height: p.height,
      fps: p.fps,
      imageClips: p.imageClips.map((c) => ({ ...c })),
      audioClips: p.audioClips.map((c) => ({ ...c })),
    }
  }

  /**
   * 编辑提交：把最新项目通过 onChange 回调通知调用方。
   *
   * 所有会修改项目的操作在完成变更后统一调用本函数。
   */
  function commit(): void {
    onChange?.(toProject())
  }

  /**
   * 在图片轨指定起始偏移处新增一个图片块。
   *
   * 占位长度取 `DEFAULT_IMAGE_CLIP_DURATION`，id 由 `crypto.randomUUID()` 生成。
   * 批量添加图片时调用方应递增 offset（例如按默认时长逐段排开），避免多图堆叠。
   *
   * @param path 图像文件路径（相对项目资产路径）
   * @param startOffset 起始偏移（秒）
   */
  function addImageAt(path: string, startOffset: number): void {
    // 图片轨不允许重叠：起始偏移解析到不重叠的空闲位置；轨道已满时不添加
    const resolved = resolveImageStartOffset(
      project.value.imageClips,
      project.value.duration,
      startOffset,
      DEFAULT_IMAGE_CLIP_DURATION,
    )
    if (resolved === null) return
    const clip: DirectorImageClip = {
      id: crypto.randomUUID(),
      path,
      startOffset: resolved,
      duration: DEFAULT_IMAGE_CLIP_DURATION,
    }
    project.value = { ...project.value, imageClips: [...project.value.imageClips, clip] }
    commit()
  }

  /**
   * 在图片轨播放头处新增一个图片块。
   *
   * 新块起点落在 `max(0, currentTime)` 秒处；批量添加请使用 `addImageAt`
   * 以便指定不同起始偏移，避免多图堆叠。
   *
   * @param path 图像文件路径（相对项目资产路径）
   */
  function addImage(path: string): void {
    addImageAt(path, Math.max(0, currentTime.value))
  }

  /**
   * 在音频轨末尾新增一个音频块。
   *
   * 新块起点落在 `max(0, currentTime)` 秒处，原始时长由调用方传入
   * （通常来自音频文件元信息），trimStart/trimEnd 初始为 0。
   *
   * @param path 音频文件路径（相对项目资产路径）
   * @param duration 音频原始时长（秒）
   */
  function addAudio(path: string, duration: number): void {
    const clip: DirectorAudioClip = {
      id: crypto.randomUUID(),
      path,
      startOffset: Math.max(0, currentTime.value),
      duration,
      trimStart: 0,
      trimEnd: 0,
    }
    project.value = { ...project.value, audioClips: [...project.value.audioClips, clip] }
    commit()
  }

  /**
   * 移动指定素材块到新的起始偏移。
   *
   * 新起点钳制在 [0, duration - 显示长度]：图片块显示长度即 duration，
   * 音频块显示长度 = duration - trimStart - trimEnd；当块长于整条轨道时
   * 钳到 0。未找到对应 id 时不做任何修改。
   *
   * @param kind 轨道类型：'image' 图片轨 / 'audio' 音频轨
   * @param id 素材块 id
   * @param startOffset 目标起始偏移（秒）
   */
  function moveClip(kind: 'image' | 'audio', id: string, startOffset: number): void {
    if (kind === 'image') {
      // 图片轨不允许重叠：移动后的起始偏移解析到不重叠的空闲位置；轨道已满时保持原位
      project.value = {
        ...project.value,
        imageClips: project.value.imageClips.map((c) => {
          if (c.id !== id) return c
          const resolved = resolveImageStartOffset(
            project.value.imageClips.filter((o) => o.id !== id),
            project.value.duration,
            startOffset,
            c.duration,
          )
          return resolved === null ? c : { ...c, startOffset: resolved }
        }),
      }
    } else {
      project.value = {
        ...project.value,
        audioClips: project.value.audioClips.map((c) => {
          if (c.id !== id) return c
          const displayLength = c.duration - c.trimStart - c.trimEnd
          return {
            ...c,
            startOffset: clamp(startOffset, 0, Math.max(0, project.value.duration - displayLength)),
          }
        }),
      }
    }
    commit()
  }

  /**
   * 调整图片块的占位长度（边缘拉伸）。
   *
   * 最小值为 0.5 秒，小于该值的输入会被钳到 0.5。
   *
   * @param id 图片块 id
   * @param duration 目标占位长度（秒）
   */
  function resizeClip(id: string, duration: number): void {
    project.value = {
      ...project.value,
      imageClips: project.value.imageClips.map((c) => {
        if (c.id !== id) return c
        // 图片轨不允许重叠：右缘拉伸不能越过下一个图片块的起点
        const nextStart = project.value.imageClips
          .filter((o) => o.id !== id && o.startOffset >= c.startOffset)
          .reduce((min, o) => Math.min(min, o.startOffset), project.value.duration)
        const maxDur = Math.max(0.5, nextStart - c.startOffset)
        return { ...c, duration: clamp(duration, 0.5, maxDur) }
      }),
    }
    commit()
  }

  /**
   * 应用相邻两个图片块共享边界拖拽的结果（绝对目标值，幂等）。
   *
   * 拖拽相邻两块共享边界时同时改变两侧长度：左块新占位长度、右块新起始偏移
   * 与新占位长度由组件按「拖拽起点快照」计算并一次性上报，故每次事件都是
   * 绝对目标值，连续多次上报不会累积漂移。
   *
   * @param leftId 左块 id
   * @param leftDuration 左块新占位长度（秒）
   * @param rightId 右块 id
   * @param rightStart 右块新起始偏移（秒）
   * @param rightDuration 右块新占位长度（秒）
   */
  function applyImageBoundary(
    leftId: string,
    leftDuration: number,
    rightId: string,
    rightStart: number,
    rightDuration: number,
  ): void {
    project.value = {
      ...project.value,
      imageClips: project.value.imageClips.map((c) => {
        if (c.id === leftId) return { ...c, duration: leftDuration }
        if (c.id === rightId) return { ...c, startOffset: rightStart, duration: rightDuration }
        return c
      }),
    }
    commit()
  }

  /**
   * 调整音频块的头尾裁剪（trimStart/trimEnd）。
   *
   * 两值均钳制到非负，且保证显示长度 = duration - trimStart - trimEnd
   * 落在 [0.5, duration]：先按剩余可裁上限钳制 trimStart，再按
   * 剩余空间钳制 trimEnd，避免把整段音频裁光。
   *
   * @param id 音频块 id
   * @param trimStart 目标头部裁剪时长（秒）
   * @param trimEnd 目标尾部裁剪时长（秒）
   */
  function trimClip(id: string, trimStart: number, trimEnd: number): void {
    project.value = {
      ...project.value,
      audioClips: project.value.audioClips.map((c) => {
        if (c.id !== id) return c
        const maxTrim = Math.max(0, c.duration - 0.5)
        const ts = clamp(trimStart, 0, maxTrim)
        const te = clamp(trimEnd, 0, maxTrim - ts)
        return { ...c, trimStart: ts, trimEnd: te }
      }),
    }
    commit()
  }

  /**
   * 选中指定素材块（仅记录选中 id，不修改项目、不触发 onChange）。
   *
   * @param id 素材块 id
   */
  function select(id: string): void {
    selectedId.value = id
  }

  /**
   * 复制当前选中素材块到剪贴板。
   *
   * 剪贴板存放素材块的副本（含 trimStart/trimEnd 等全部字段），
   * 未选中任何素材块时无操作。
   */
  function copySelected(): void {
    const id = selectedId.value
    if (!id) return
    const image = project.value.imageClips.find((c) => c.id === id)
    if (image) {
      clipboard.value = { ...image }
      return
    }
    const audio = project.value.audioClips.find((c) => c.id === id)
    if (audio) {
      clipboard.value = { ...audio }
    }
  }

  /**
   * 粘贴剪贴板中的素材块。
   *
   * 按被复制块的类型落到同一条轨道，新块 id 重新生成、
   * startOffset = 被复制块 startOffset + 1（`computePasteOffset`）；
   * 剪贴板为空时无操作。
   */
  function paste(): void {
    const src = clipboard.value
    if (!src) return
    if (isAudioClip(src)) {
      const clip: DirectorAudioClip = { ...src, id: crypto.randomUUID(), startOffset: computePasteOffset(src) }
      project.value = { ...project.value, audioClips: [...project.value.audioClips, clip] }
    } else {
      // 图片粘贴同样不允许与既有图片块重叠；轨道已满时不粘贴
      const resolved = resolveImageStartOffset(
        project.value.imageClips,
        project.value.duration,
        computePasteOffset(src),
        src.duration,
      )
      if (resolved === null) return
      const clip: DirectorImageClip = {
        ...src,
        id: crypto.randomUUID(),
        startOffset: resolved,
      }
      project.value = { ...project.value, imageClips: [...project.value.imageClips, clip] }
    }
    commit()
  }

  /**
   * 删除当前选中的素材块并清空选中。
   *
   * 若选中的 id 同时存在于两条轨道（理论上不可能）则从两条轨道都删除；
   * 未选中或 id 不存在时无操作。
   */
  function removeSelected(): void {
    const id = selectedId.value
    if (!id) return
    const found =
      project.value.imageClips.some((c) => c.id === id)
      || project.value.audioClips.some((c) => c.id === id)
    if (!found) return
    project.value = {
      ...project.value,
      imageClips: project.value.imageClips.filter((c) => c.id !== id),
      audioClips: project.value.audioClips.filter((c) => c.id !== id),
    }
    selectedId.value = null
    commit()
  }

  /**
   * 设置播放头当前时间。
   *
   * 不修改项目、不触发 onChange；实际播放时的走时由组件接入的
   * PlaybackEngine 驱动，通过本方法同步时间轴游标。
   *
   * @param t 当前时间（秒）
   */
  function setCurrentTime(t: number): void {
    currentTime.value = t
  }

  /**
   * 设置时间轴缩放。
   *
   * @param z 缩放值（像素/秒）
   */
  function setZoom(z: number): void {
    zoom.value = z
  }

  /**
   * 切换播放/暂停：idle → playing → paused → playing。
   */
  function togglePlay(): void {
    playState.value = playState.value === 'playing' ? 'paused' : 'playing'
  }

  /**
   * 停止播放：回到 idle 状态（不重置 currentTime，由调用方按需处理）。
   */
  function stopPlay(): void {
    playState.value = 'idle'
  }

  return {
    project,
    imageClips,
    audioClips,
    duration,
    currentTime,
    playState,
    zoom,
    selectedId,
    clipboard,
    syncFromProject,
    toProject,
    addImage,
    addImageAt,
    addAudio,
    moveClip,
    resizeClip,
    applyImageBoundary,
    trimClip,
    select,
    copySelected,
    paste,
    removeSelected,
    setCurrentTime,
    setZoom,
    togglePlay,
    stopPlay,
  }
}
