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
import InputPreviewNode from '../components/canvas/nodes/InputPreviewNode.vue'
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

/**
 * 节点分类：添加节点菜单按此分组为多列展示。
 * - load：加载类（把项目已有资产载入画布，无输入端口）
 * - generate：生成类（通过 AI/工作流产出新媒体内容）
 * - tool：工具类（文本手写/媒体变换处理，如取帧、拼接、裁剪）
 */
export type NodeCategory = 'load' | 'generate' | 'tool'

/** 添加节点菜单分类元数据（数组顺序即菜单列顺序） */
export interface NodeCategoryMeta {
  /** 分类 id（与 NodePrototype.category 对应） */
  id: NodeCategory
  /** 分类标题（菜单列 subheader 文案） */
  label: string
  /** 分类图标（Material Design Icons 名称） */
  icon: string
}

/** 添加节点菜单的固定分类列：加载 / 生成 / 工具 */
export const NODE_CATEGORIES: NodeCategoryMeta[] = [
  { id: 'load', label: '加载', icon: 'mdi-tray-arrow-down' },
  { id: 'generate', label: '生成', icon: 'mdi-auto-fix' },
  { id: 'tool', label: '工具', icon: 'mdi-tools' },
]

/** 节点原型：定义节点类型的端口、能力与渲染组件 */
export interface NodePrototype {
  /** 该节点类型的唯一标识，代码中硬编码 */
  id: string
  /** 节点名称（方便用户阅读） */
  name: string
  /** 节点图标（Material Design Icons 名称，用于菜单/列表展示） */
  icon: string
  /** 所属分类（添加节点菜单按此分列展示） */
  category: NodeCategory
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
   * 供需要替换默认整体遮罩（半透明白底 + spinner + 「中断」，会拦截节点交互）的
   * 节点类型自行声明。组件接收 props：{ status: GenerateStatus; node: CanvasNodeData;
   * project: string }，emits：interrupt(nodeId) / retry(nodeId)（与默认遮罩一致）。
   *
   * 两种形态：
   * - 非阻塞轻量遮罩组件：遮罩不拦截交互，仅补充部分状态 UI；
   * - 空组件（`() => null`，如 AI 文本生成节点）：节点主体完全自绘运行/错误状态
   *   （节点内 Thinking 条 + 「停止」按钮 + 响应区错误红字），画布不渲染任何遮罩。
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
    category: 'load',
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
    category: 'load',
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
    category: 'load',
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
    category: 'generate',
    // 单一输入连接点：图片（参考图，可多路）与文本（外部提示词，最多一个）共用。
    // 连接后按来源节点输出类型自动归类——图片进输入预览与工作流输入图，文本作为 prompt
    // 取值（禁用节点内提示词输入框，见 useCanvasNodeOps.generateNode）。
    inputPorts: [{ id: 'in', type: ['image', 'text'], label: '输入' }],
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
    category: 'tool',
    inputPorts: [],
    outputPorts: [{ id: 'out', type: 'text', label: '文本' }],
    resizeable: true,
    bodyComponent: TextNode,
  },
  {
    id: 'video-generate',
    name: '生成视频',
    icon: 'mdi-video-plus',
    category: 'generate',
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
    category: 'generate',
    // 单一输入连接点：同时接受媒体（图片/音频/视频）与文本来源。
    // 连接后按来源节点输出类型自动归类 —— 媒体进输入预览（与生成节点同机制），
    // 「文本」节点内容自动作为用户输入（见 useCanvasNodeOps.llmMediaInputsOf / textInputsOf）。
    inputPorts: [{ id: 'in', type: ['media', 'text'], label: '输入' }],
    outputPorts: [{ id: 'out', type: 'text', label: '文本' }],
    resizeable: true,
    bodyComponent: AiTextGenerateNode,
    // 空状态遮罩：节点主体完全自绘运行/错误状态 UI（顶部 Thinking 条 + 全控件禁用 +
    // 「停止」按钮 + 响应区错误红字），画布不再叠加 spinner/中断/错误浮层（避免与节点内
    // 重复的 Thinking 层）；声明空组件仅为让 CanvasNodeCard 跳过默认整体阻塞遮罩
    // （默认遮罩会盖住流式输出并拦截节点内控件，见 docs/canvas/llm-session.md）
    statusOverlay: () => null,
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
    // @mdi/font 7.4.0 无 mdi-voice 字形（仅 mdi-voicemail），改用 account-voice
    icon: 'mdi-account-voice',
    category: 'generate',
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
    id: 'input-preview',
    name: '输入预览',
    icon: 'mdi-eye-outline',
    category: 'tool',
    // 纯展示节点：单一输入口接受任意来源（媒体 + 文本），穿透一层预览「来源节点自身的输入」。
    // 无输出端口——不参与数据流，不能作为连线源（故也不出现在成组连接目标菜单的兼容判定中）。
    inputPorts: [{ id: 'in', type: ['media', 'text'], label: '输入' }],
    outputPorts: [],
    resizeable: true,
    // 预览内容需要空间：来源行 + 媒体缩略图组（最多三组）+ 文本块；默认 320×300 可完整容纳
    // 常见「图片 + 音频/视频」组合而不出现节点内滚动，用户可再手动缩放
    defaultSize: { width: 320, height: 300 },
    bodyComponent: InputPreviewNode,
    // 无 editorComponent：全部内容在节点主体内展示（与 AI 文本生成节点同形态）；
    // 未声明 canGenerate / hasHistory → 右键菜单自动无「重新生成」「历史」入口
  },
  {
    id: 'video-frame-extract',
    name: '获取视频帧',
    icon: 'mdi-camera-outline',
    category: 'tool',
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
    category: 'tool',
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
      // 编码方式：copy=无损（各段规格须一致）/ reencode=重编码（允许异构规格）；缺省重编码
      mode: 'reencode',
      // 输出尺寸策略（仅重编码生效）：custom / max（面积最大段）/ min（面积最小段）
      sizeMode: 'max',
      // 自定义输出宽高（sizeMode=custom 时生效；服务端自动规整为偶数）
      width: 1920,
      height: 1080,
      // 是否开启自然过渡（相邻段之间交叉淡化；仅 reencode 生效，copy 无法插入 xfade）
      transition: false,
      // 交叉过渡时长（秒，0~5，默认 0.5；音视频同时过渡）
      crossfadeDuration: 0.5,
    },
  },
  {
    id: 'video-trim',
    name: '裁剪视频',
    icon: 'mdi-content-cut',
    category: 'tool',
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
    category: 'tool',
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
