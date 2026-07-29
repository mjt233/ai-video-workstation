/**
 * 自定义资产文件类型与路径工具。
 * 负责扩展名识别、预览类型判断、图标映射与路径拼接。
 */

/** 预览类型 */
export type PreviewKind = 'image' | 'video' | 'audio' | 'text' | 'none'

/** 视图模式：列表 / 网格 */
export type ViewMode = 'list' | 'grid'

/** 面包屑项 */
export interface BreadcrumbItem {
  /** 显示标题 */
  title: string
  /** 相对 assert/custom 的路径，根目录为空串 */
  path: string
  /** 是否为当前路径（禁用点击） */
  disabled: boolean
}

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp']
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v']
const AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']
const TEXT_EXTS = [
  '.md', '.txt', '.json', '.xml', '.yaml', '.yml', '.toml', '.js', '.ts', '.py',
  '.css', '.html', '.vue', '.java', '.c', '.cpp', '.h', '.sh', '.bat', '.ps1',
  '.env', '.cfg', '.ini', '.log', '.csv', '.tsv', '.sql', '.rb', '.go', '.rs',
  '.swift', '.kt', '.gradle', '.properties',
]

/**
 * 拼接相对路径。
 * @param base 父路径
 * @param name 子名称
 * @returns 拼接后的路径
 */
export function joinPath(base: string, name: string): string {
  return base ? `${base}/${name}` : name
}

/**
 * 获取文件扩展名（小写，含点）。
 * @param filename 文件名
 * @returns 扩展名，无扩展名时返回空串
 */
export function extname(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(i).toLowerCase() : ''
}

/**
 * 判断是否为图片文件。
 * @param filename 文件名
 */
export function isImageFile(filename: string): boolean {
  return IMAGE_EXTS.includes(extname(filename))
}

/**
 * 判断是否为视频文件。
 * @param filename 文件名
 */
export function isVideoFile(filename: string): boolean {
  return VIDEO_EXTS.includes(extname(filename))
}

/**
 * 判断是否为音频文件。
 * @param filename 文件名
 */
export function isAudioFile(filename: string): boolean {
  return AUDIO_EXTS.includes(extname(filename))
}

/**
 * 判断是否为文本文件。
 * @param filename 文件名
 */
export function isTextFile(filename: string): boolean {
  return TEXT_EXTS.includes(extname(filename))
}

/**
 * 判断文件是否支持在线预览。
 * @param filename 文件名
 */
export function isPreviewable(filename: string): boolean {
  return isImageFile(filename)
    || isVideoFile(filename)
    || isAudioFile(filename)
    || isTextFile(filename)
}

/**
 * 根据扩展名推断预览类型。
 * @param filename 文件名
 * @returns 预览类型
 */
export function getPreviewKind(filename: string): PreviewKind {
  if (isImageFile(filename)) return 'image'
  if (isVideoFile(filename)) return 'video'
  if (isAudioFile(filename)) return 'audio'
  if (isTextFile(filename)) return 'text'
  return 'none'
}

/**
 * 获取文件图标。
 * @param filename 文件名
 * @returns MDI 图标名
 */
export function fileIcon(filename: string): string {
  const ext = extname(filename)
  if (IMAGE_EXTS.includes(ext)) return 'mdi-file-image'
  if (VIDEO_EXTS.includes(ext)) return 'mdi-file-video'
  if (AUDIO_EXTS.includes(ext)) return 'mdi-file-music'
  if (['.pdf'].includes(ext)) return 'mdi-file-pdf-box'
  if (['.zip', '.tar', '.gz', '.rar', '.7z'].includes(ext)) return 'mdi-folder-zip'
  if (['.doc', '.docx'].includes(ext)) return 'mdi-file-word'
  if (['.xls', '.xlsx'].includes(ext)) return 'mdi-file-excel'
  if (['.md'].includes(ext)) return 'mdi-language-markdown'
  if (['.json', '.xml', '.yaml', '.yml', '.toml'].includes(ext)) return 'mdi-code-json'
  if (['.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.css', '.html', '.vue'].includes(ext)) {
    return 'mdi-code-tags'
  }
  return 'mdi-file-document-outline'
}

/**
 * 获取文件图标颜色。
 * @param filename 文件名
 * @returns Vuetify 颜色名
 */
export function fileIconColor(filename: string): string {
  const ext = extname(filename)
  if (IMAGE_EXTS.includes(ext)) return 'pink-darken-1'
  if (VIDEO_EXTS.includes(ext)) return 'indigo-darken-1'
  if (AUDIO_EXTS.includes(ext)) return 'deep-purple-darken-1'
  if (['.pdf'].includes(ext)) return 'red-darken-1'
  if (['.zip', '.tar', '.gz', '.rar', '.7z'].includes(ext)) return 'brown-darken-1'
  if (['.md'].includes(ext)) return 'blue-darken-1'
  if (['.json', '.xml', '.yaml', '.yml'].includes(ext)) return 'orange-darken-1'
  if (['.js', '.ts', '.py'].includes(ext)) return 'green-darken-1'
  return 'grey-darken-1'
}

/**
 * 构造文件在 assert/custom 下的相对路径。
 * @param currentDir 当前目录（相对 assert/custom，根为空串）
 * @param filename 文件名
 * @returns 完整相对路径
 */
export function relFilePath(currentDir: string, filename: string): string {
  return currentDir
    ? `assert/custom/${currentDir}/${filename}`
    : `assert/custom/${filename}`
}

/**
 * 构造文件访问 URL。
 * @param project 项目名
 * @param currentDir 当前目录（相对 assert/custom，根为空串）
 * @param filename 文件名
 * @returns API URL
 */
export function fileUrl(project: string, currentDir: string, filename: string): string {
  return `/api/fs/${project}/${relFilePath(currentDir, filename)}`
}

/**
 * 根据当前目录生成面包屑。
 * @param currentDir 当前目录（相对 assert/custom，根为空串）
 * @returns 面包屑项列表
 */
export function buildBreadcrumbItems(currentDir: string): BreadcrumbItem[] {
  const parts = currentDir ? currentDir.split('/') : []
  const items: BreadcrumbItem[] = [
    { title: '自定义资产', path: '', disabled: currentDir === '' },
  ]
  let accumulated = ''
  for (const part of parts) {
    accumulated = accumulated ? `${accumulated}/${part}` : part
    items.push({
      title: part,
      path: accumulated,
      disabled: accumulated === currentDir,
    })
  }
  return items
}

/**
 * 获取预览类型对应的标题图标。
 * @param kind 预览类型
 * @returns MDI 图标名
 */
export function previewKindIcon(kind: PreviewKind): string {
  switch (kind) {
    case 'image': return 'mdi-file-image'
    case 'video': return 'mdi-file-video'
    case 'audio': return 'mdi-file-music'
    case 'text': return 'mdi-file-document-outline'
    default: return 'mdi-file-eye-outline'
  }
}

/**
 * 校验文件/目录名称是否合法。
 * @param name 名称
 * @returns 错误信息；合法时返回空串
 */
export function validateEntryName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '名称不能为空'
  if (/[\\/:*?"<>|]/.test(trimmed)) return '名称包含非法字符'
  return ''
}
