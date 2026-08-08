import type { NodeConfig, Port } from './types'
import type { Component } from 'vue'
import ImageLoaderNode from '../components/canvas/nodes/ImageLoaderNode.vue'
import ImageGenerateNode from '../components/canvas/nodes/ImageGenerateNode.vue'
import TextNode from '../components/canvas/nodes/TextNode.vue'
import AudioLoaderNode from '../components/canvas/nodes/AudioLoaderNode.vue'
import VideoLoaderNode from '../components/canvas/nodes/VideoLoaderNode.vue'
import VideoGenerateNode from '../components/canvas/nodes/VideoGenerateNode.vue'
import ExtractFrameNode from '../components/canvas/nodes/ExtractFrameNode.vue'
import ImageGenerateEditor from '../components/canvas/editors/ImageGenerateEditor.vue'
import ImageLoaderEditor from '../components/canvas/editors/ImageLoaderEditor.vue'
import AudioLoaderEditor from '../components/canvas/editors/AudioLoaderEditor.vue'
import VideoLoaderEditor from '../components/canvas/editors/VideoLoaderEditor.vue'
import VideoGenerateEditor from '../components/canvas/editors/VideoGenerateEditor.vue'
import ExtractFrameEditor from '../components/canvas/editors/ExtractFrameEditor.vue'

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
    resizeable: false,
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
    resizeable: false,
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
    resizeable: false,
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
    bodyComponent: ImageGenerateNode,
    editorComponent: ImageGenerateEditor,
    getOutputAssetPath: generateOutput,
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
    bodyComponent: VideoGenerateNode,
    editorComponent: VideoGenerateEditor,
    getOutputAssetPath: generateOutput,
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
    id: 'video-frame-extract',
    name: '获取视频帧',
    icon: 'mdi-camera-outline',
    // 输入视频类型、输出图片类型；手动点击提取（服务端 ffmpeg）
    inputPorts: [{ id: 'in', type: 'video', label: '视频' }],
    outputPorts: [{ id: 'out', type: 'image', label: '图片' }],
    resizeable: true,
    bodyComponent: ExtractFrameNode,
    editorComponent: ExtractFrameEditor,
    getOutputAssetPath: generateOutput,
    defaultConfig: {
      frameIndex: 0,
      history: [],
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
