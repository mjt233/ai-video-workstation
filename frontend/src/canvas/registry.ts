import type { Port } from './types'
import type { Component } from 'vue'
import ImageLoaderNode from '../components/canvas/nodes/ImageLoaderNode.vue'
import ImageGenerateNode from '../components/canvas/nodes/ImageGenerateNode.vue'
import TextNode from '../components/canvas/nodes/TextNode.vue'
import AudioLoaderNode from '../components/canvas/nodes/AudioLoaderNode.vue'
import VideoLoaderNode from '../components/canvas/nodes/VideoLoaderNode.vue'
import ImageGenerateEditor from '../components/canvas/editors/ImageGenerateEditor.vue'
import ImageLoaderEditor from '../components/canvas/editors/ImageLoaderEditor.vue'
import AudioLoaderEditor from '../components/canvas/editors/AudioLoaderEditor.vue'
import VideoLoaderEditor from '../components/canvas/editors/VideoLoaderEditor.vue'

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
