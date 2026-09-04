import type { NodeConfig, Port } from './types'
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
  /** 创建节点时的默认配置（可选） */
  defaultConfig?: NodeConfig
  /**
   * 输出资产路径解析：由节点自身配置推导当前输出资产（项目内相对路径），无则 undefined。
   * 未声明时 getNodeCurrentAssetPath 按画布约定默认读 config.current.path。
   */
  getOutputAssetPath?: (config: NodeConfig) => string | undefined
  /**
   * 生成类节点产物扩展名（无点号，如 jpg / mp4 / png / flac）。
   * 声明后，产物路径按固定文件名推导：assert/{scope}/canvas/{nodeId}/output.{ext}
   * （见 paths.ts canvasNodeOutputPath）——"当前结果"为文件系统事实，不再读写 config.current/history。
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
    // 输入/输出均为 audio；手动点击裁剪（服务端 ffmpeg 重编码 flac，小数秒精度）
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
