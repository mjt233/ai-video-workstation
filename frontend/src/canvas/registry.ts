import type { NodeConfig, Port } from './types'
import { AUDIO_TRIM_FORMAT_ORIG, AUDIO_TRIM_MP3_BITRATE_DEFAULT } from './audioTrim'
import type { Component } from 'vue'
import ImageLoaderNode from '../components/canvas/nodes/ImageLoaderNode.vue'
import ImageGenerateNode from '../components/canvas/nodes/ImageGenerateNode.vue'
import TextNode from '../components/canvas/nodes/TextNode.vue'
import AudioLoaderNode from '../components/canvas/nodes/AudioLoaderNode.vue'
import VideoLoaderNode from '../components/canvas/nodes/VideoLoaderNode.vue'
import VideoGenerateNode from '../components/canvas/nodes/VideoGenerateNode.vue'
import ExtractFrameNode from '../components/canvas/nodes/ExtractFrameNode.vue'
import ConcatVideoNode from '../components/canvas/nodes/ConcatVideoNode.vue'
import TrimVideoNode from '../components/canvas/nodes/TrimVideoNode.vue'
import AudioTrimNode from '../components/canvas/nodes/AudioTrimNode.vue'
import TtsGenerateNode from '../components/canvas/nodes/TtsGenerateNode.vue'
import AiTextGenerateNode from '../components/canvas/nodes/AiTextGenerateNode.vue'
import AiTextStatusOverlay from '../components/canvas/nodes/AiTextStatusOverlay.vue'
import ImageGenerateEditor from '../components/canvas/editors/ImageGenerateEditor.vue'
import ImageLoaderEditor from '../components/canvas/editors/ImageLoaderEditor.vue'
import AudioLoaderEditor from '../components/canvas/editors/AudioLoaderEditor.vue'
import VideoLoaderEditor from '../components/canvas/editors/VideoLoaderEditor.vue'
import VideoGenerateEditor from '../components/canvas/editors/VideoGenerateEditor.vue'
import ExtractFrameEditor from '../components/canvas/editors/ExtractFrameEditor.vue'
import ConcatVideoEditor from '../components/canvas/editors/ConcatVideoEditor.vue'
import TrimVideoEditor from '../components/canvas/editors/TrimVideoEditor.vue'
import AudioTrimEditor from '../components/canvas/editors/AudioTrimEditor.vue'
import TtsGenerateEditor from '../components/canvas/editors/TtsGenerateEditor.vue'

/** 节点原型：定义节点类型的端口、能力与渲染组件 */
export interface NodePrototype {
  /** 该节点类型的唯一标识，代码中硬编码 */
  id: string
  /** 节点名称（方便用户阅读） */
  name: string
  /** 节点图标（Material Design Icons 名称，用于菜单/列表展示） */
  icon: string
  /** 输入端口定义（可接受的连接类型由此决定） */
  inputPorts: Port[]
  /** 输出端口定义 */
  outputPorts: Port[]
  /** 该类型节点是否允许用户自由缩放大小 */
  resizeable: boolean
  /** 该类型节点是否有「重新生成」能力（驱动右键菜单「重新生成」入口显隐） */
  canGenerate?: boolean
  /** 该类型节点是否有版本历史（驱动右键菜单「历史」入口显隐） */
  hasHistory?: boolean
  /** 渲染节点卡片主体的 Vue 组件（可拿到 node/project 等 props） */
  bodyComponent?: Component
  /** 节点被选中后渲染在节点下方的配置组件 */
  editorComponent?: Component
  /**
   * 节点自定义状态遮罩组件（可选；未声明时 CanvasNodeCard 渲染默认通用遮罩）。
   *
   * 供需要「非阻塞轻量遮罩」的节点自行声明（如 AI 文本生成节点：流式输出与
   * 节点内「停止」按钮不能被整体遮罩拦截）。组件接收
   * props：{ status: GenerateStatus; node: CanvasNodeData; project: string }，
   * emits：interrupt(nodeId) / retry(nodeId)（与默认遮罩一致）。
   */
  statusOverlay?: Component
  /** 创建节点时的默认配置（可选） */
  defaultConfig?: NodeConfig
  /** 创建节点时的默认尺寸（可选；未声明时使用全局兜底 240×160，见 useCanvasStore.DEFAULT_NODE_SIZE） */
  defaultSize?: { width: number; height: number }
  /**
   * 输出资产路径解析：由节点自身配置推导当前输出资产（项目内相对路径），无则 undefined。
   * 未声明时 getNodeCurrentAssetPath 按画布约定默认读 config.current.path。
   */
  getOutputAssetPath?: (config: NodeConfig) => string | undefined
  /**
   * 生成类节点产物扩展名（无点号，如 jpg / mp4 / png / flac）。
   * 声明后，产物路径按固定文件名推导：assert/{scope}/canvas/{nodeId}/output.{ext}
   * （见 paths.ts canvasNodeOutputPath）——"当前结果"为文件系统事实，不再读写 config.current/history。
   * 例外：裁剪音频（audio-trim）节点产物扩展名随 config.format 变化（默认「原格式」跟随输入，
   * 见 canvas/audioTrim.ts），此处 'flac' 仅作无配置上下文时的兜底声明。
   */
  outputExt?: string
}

/** 加载类节点输出资产：config.assetPath（非空字符串） */
function loaderOutput(config: NodeConfig): string | undefined {
  const ap = config.assetPath
  return typeof ap === 'string' && ap ? ap : undefined
}

/** 生成类节点输出资产：config.current.path（生成产物回写 current/history 是画布约定） */
function generateOutput(config: NodeConfig): string | undefined {
  const cur = config.current as { path?: string } | undefined
  return cur?.path
}

/** 内置节点原型注册表 */
export const NODE_PROTOTYPES: NodePrototype[] = [
  {
    id: 'image-loader',
    name: '加载图片',
    icon: 'mdi-image-outline',
    inputPorts: [],
    outputPorts: [{ id: 'out', type: 'image', label: '图片' }],
    resizeable: true,
    bodyComponent: ImageLoaderNode,
    editorComponent: ImageLoaderEditor,
    getOutputAssetPath: loaderOutput,
  },
  {
    id: 'audio-loader',
    name: '加载音频',
    icon: 'mdi-music-note',
    inputPorts: [],
    outputPorts: [{ id: 'out', type: 'audio', label: '音频' }],
    resizeable: true,
    bodyComponent: AudioLoaderNode,
    editorComponent: AudioLoaderEditor,
    getOutputAssetPath: loaderOutput,
  },
  {
    id: 'video-loader',
    name: '加载视频',
    icon: 'mdi-video-outline',
    inputPorts: [],
    outputPorts: [{ id: 'out', type: 'video', label: '视频' }],
    resizeable: true,
    bodyComponent: VideoLoaderNode,
    editorComponent: VideoLoaderEditor,
    getOutputAssetPath: loaderOutput,
  },
  {
    id: 'image-generate',
    name: '生成图片',
    icon: 'mdi-image-plus',
    inputPorts: [{ id: 'in', type: 'image', label: '参考图' }],
    outputPorts: [{ id: 'out', type: 'image', label: '图片' }],
    resizeable: true,
    canGenerate: true,
    hasHistory: true,
    bodyComponent: ImageGenerateNode,
    editorComponent: ImageGenerateEditor,
    getOutputAssetPath: generateOutput,
    outputExt: 'jpg',
  },
  {
    id: 'text',
    name: '文本',
    icon: 'mdi-format-text',
    inputPorts: [],
    outputPorts: [{ id: 'out', type: 'text', label: '文本' }],
    resizeable: true,
    bodyComponent: TextNode,
  },
  {
    id: 'video-generate',
    name: '生成视频',
    icon: 'mdi-video-plus',
    // 单一 media 输入连接点：素材类型由来源节点类型（图片/视频/音频加载节点）自动归类
    inputPorts: [{ id: 'in', type: 'media', label: '输入' }],
    outputPorts: [{ id: 'out', type: 'video', label: '视频' }],
    resizeable: true,
    canGenerate: true,
    hasHistory: true,
    bodyComponent: VideoGenerateNode,
    editorComponent: VideoGenerateEditor,
    getOutputAssetPath: generateOutput,
    outputExt: 'mp4',
    defaultConfig: {
      workflowId: 'image-to-video',
      workflowImpl: undefined,
      workflowParams: {},
      mode: 'director',
      prompt: '',
      director: { duration: 0, width: 0, height: 0, fps: 0, imageClips: [], audioClips: [] },
      inputOrder: [],
    },
  },
  {
    id: 'text-ai',
    name: 'AI文本生成',
    icon: 'mdi-robot-outline',
    // 单一输入连接点：同时接受媒体（图片/音频/视频）与文本来源。
    // 连接后按来源节点输出类型自动归类 —— 媒体进输入预览（与生成节点同机制），
    // 「文本」节点内容自动作为用户输入（见 useCanvasNodeOps.llmMediaInputsOf / textInputsOf）。
    inputPorts: [{ id: 'in', type: ['media', 'text'], label: '输入' }],
    outputPorts: [{ id: 'out', type: 'text', label: '文本' }],
    resizeable: true,
    bodyComponent: AiTextGenerateNode,
    // 自定义非阻塞轻量遮罩：仅接入标准状态机，遮罩不拦截流式输出与节点内「停止」按钮
    // （默认整体遮罩会盖住内容，与「不修改原有 UI 交互效果」冲突，见 docs/plans/ai-text-loading-llm-session.md）
    statusOverlay: AiTextStatusOverlay,
    // 有文本历史版本（右键「历史」打开的是 AiTextHistoryDialog —— config.outputHistory
    // 纯文本快照历史，非资产文件历史；与产物节点的 CanvasAssertHistoryDialog 不同，
    // AssetCanvas 按原型分支渲染对应对话框）
    hasHistory: true,
    // 默认尺寸大于通用兜底（240×160）：AI 文本节点含模型/预设下拉 + 输入预览 + 双栏文本区，
    // 需要更多空间展示内容（用户可再手动缩放）
    defaultSize: { width: 360, height: 240 },
    defaultConfig: {
      providerInstanceId: '',
      modelId: '',
      reasoningLevel: '',
      promptPresetId: '',
      input: '',
      output: '',
    },
  },
  {
    id: 'tts-generate',
    name: 'TTS声音生成',
    icon: 'mdi-voice',
    // 音频输入（可选）：音色克隆模式下作为参考音色；音色设计模式无需输入
    inputPorts: [{ id: 'in', type: 'audio', label: '参考音频' }],
    outputPorts: [{ id: 'out', type: 'audio', label: '音频' }],
    resizeable: true,
    canGenerate: true,
    hasHistory: true,
    bodyComponent: TtsGenerateNode,
    editorComponent: TtsGenerateEditor,
    getOutputAssetPath: generateOutput,
    outputExt: 'flac',
    defaultConfig: {
      mode: 'design', // 'clone' | 'design'，编辑器切换
      workflowImpl: undefined,
      workflowParams: {},
      text: '',
      refText: '',
      prompt: '',
    },
  },
  {
    id: 'video-frame-extract',
    name: '获取视频帧',
    icon: 'mdi-camera-outline',
    // 输入视频类型、输出图片类型；手动点击提取（服务端 ffmpeg）
    inputPorts: [{ id: 'in', type: 'video', label: '视频' }],
    outputPorts: [{ id: 'out', type: 'image', label: '图片' }],
    resizeable: true,
    canGenerate: true,
    bodyComponent: ExtractFrameNode,
    editorComponent: ExtractFrameEditor,
    getOutputAssetPath: generateOutput,
    outputExt: 'png',
    defaultConfig: {
      frameIndex: 0,
      history: [],
    },
  },
  {
    id: 'video-concat',
    name: '拼接视频',
    icon: 'mdi-video-switch-outline',
    // 单一 video 输入连接点：同一端口可连接多段视频（无输入上限校验），拼接顺序由 config.inputOrder 决定
    inputPorts: [{ id: 'in', type: 'video', label: '视频' }],
    outputPorts: [{ id: 'out', type: 'video', label: '视频' }],
    resizeable: true,
    canGenerate: true,
    bodyComponent: ConcatVideoNode,
    editorComponent: ConcatVideoEditor,
    getOutputAssetPath: generateOutput,
    outputExt: 'mp4',
    defaultConfig: {
      inputOrder: [],
      history: [],
    },
  },
  {
    id: 'video-trim',
    name: '裁剪视频',
    icon: 'mdi-content-cut',
    // 输入/输出均为 video；手动点击裁剪（服务端 ffmpeg 重编码，保证帧/小数秒精度）
    inputPorts: [{ id: 'in', type: 'video', label: '视频' }],
    outputPorts: [{ id: 'out', type: 'video', label: '视频' }],
    resizeable: true,
    canGenerate: true,
    bodyComponent: TrimVideoNode,
    editorComponent: TrimVideoEditor,
    getOutputAssetPath: generateOutput,
    outputExt: 'mp4',
    defaultConfig: {
      startMode: 'time',
      startValue: 0,
      duration: 1,
    },
  },
  {
    id: 'audio-trim',
    name: '裁剪音频',
    icon: 'mdi-scissors-cutting',
    // 输入/输出均为 audio；手动点击裁剪（服务端 ffmpeg 重编码，小数秒精度）。
    // 产物扩展名随 config.format 变化（默认「原格式」= 跟随输入扩展名，见 canvas/audioTrim.ts）：
    // 本原型 outputExt: 'flac' 仅作为无配置上下文时的兜底声明，实际路径推导走
    // getNodeCurrentAssetPath 的 audio-trim 分支（audioTrimOutputExt）
    inputPorts: [{ id: 'in', type: 'audio', label: '音频' }],
    outputPorts: [{ id: 'out', type: 'audio', label: '音频' }],
    resizeable: true,
    canGenerate: true,
    bodyComponent: AudioTrimNode,
    editorComponent: AudioTrimEditor,
    getOutputAssetPath: generateOutput,
    outputExt: 'flac',
    defaultConfig: {
      startValue: 0,
      duration: 1,
      format: AUDIO_TRIM_FORMAT_ORIG,
      mp3Bitrate: AUDIO_TRIM_MP3_BITRATE_DEFAULT,
    },
  },
]

/**
 * 按原型 id 查询节点原型。
 *
 * @param prototypeId 原型 id
 * @returns 原型或 undefined
 */
export function getPrototype(prototypeId: string): NodePrototype | undefined {
  return NODE_PROTOTYPES.find((p) => p.id === prototypeId)
}
