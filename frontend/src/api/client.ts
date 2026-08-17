import axios from 'axios'
import type { AxiosError } from 'axios'

const client = axios.create({ baseURL: '/api' })

export interface ProjectEntry {
  name: string
}

export interface DirEntry {
  name: string
  type: 'file' | 'dir'
}

export interface DirResponse {
  entries: DirEntry[]
}

export async function getProjects(): Promise<ProjectEntry[]> {
  const { data } = await client.get<ProjectEntry[]>('/projects')
  return data
}

/**
 * 手动创建空项目（首页「新建项目」使用）。
 * 服务端会创建标准目录骨架（prompt/、assert/）、空的 overview.md 与默认尺寸的 project.json。
 * @param name 项目名称（不允许包含 / 或 \，长度不超过 64 个字符）
 * @returns 创建成功的项目名
 */
export async function createProject(name: string): Promise<{ name: string }> {
  const { data } = await client.post<{ name: string }>('/projects', { name })
  return data
}

/**
 * 从文件系统读取文件内容。注意：如果文件是.json，返回的数据直接就是已完成反序列化的对象或数组。
 */
export async function readFs(project: string, path: string): Promise<DirResponse | string> {
  const { data } = await client.get<DirResponse | string>(`/fs/${project}/${path}`)
  return data
}

export async function writeFs(project: string, path: string, content: string): Promise<{ success: boolean }> {
  const { data } = await client.post<{ success: boolean }>(`/fs/${project}/${path}`, { content })
  return data
}

export async function existsFs(project: string, path: string): Promise<boolean> {
  try {
    await client.head(`/fs/${project}/${path}`)
    return true
  } catch {
    return false
  }
}

/** 创建目录（用于 assert/custom/ 下） */
export async function mkdirFs(project: string, dirPath: string): Promise<{ success: boolean }> {
  const { data } = await client.post<{ success: boolean }>(`/fs/${project}/mkdir`, { path: dirPath })
  return data
}

/** 重命名/移动文件或目录（用于 assert/custom/ 下） */
export async function renameFs(project: string, from: string, to: string): Promise<{ success: boolean }> {
  const { data } = await client.post<{ success: boolean }>(`/fs/${project}/rename`, { from, to })
  return data
}

/** 复制文件或目录（源/目标均须在 assert/ 下，用于画布资产复制、设为分镜场景图等） */
export async function copyFs(project: string, from: string, to: string): Promise<{ success: boolean; from: string; to: string }> {
  const { data } = await client.post<{ success: boolean; from: string; to: string }>(`/fs/${project}/copy`, { from, to })
  return data
}

/** 删除文件或目录递归（用于 assert/custom/ 下） */
export async function deleteFs(project: string, relPath: string): Promise<{ success: boolean }> {
  const { data } = await client.delete<{ success: boolean }>(`/fs/${project}/${relPath}`)
  return data
}

/** 上传任意文件到自定义资产目录 */
export async function uploadFs(project: string, destPath: string, file: File): Promise<{ success: boolean; path: string }> {
  const form = new FormData()
  form.append('path', destPath)
  form.append('file', file)
  const { data } = await client.post<{ success: boolean; path: string }>(`/fs/${project}/upload`, form)
  return data
}

/**
 * 构建项目整体导出（zip 下载）的 URL。
 * 由浏览器直接访问该地址触发原生下载，避免大文件在内存中缓冲。
 * @param project 项目名
 * @returns 导出下载地址
 */
export function getProjectExportUrl(project: string): string {
  return `/api/projects/${encodeURIComponent(project)}/export`
}

/**
 * 触发整个项目 zip 下载（浏览器原生下载，无进度回调）。
 * 通过临时 <a download> 元素点击触发，下载文件名与项目名一致。
 * @param project 项目名
 */
export function downloadProjectExport(project: string): void {
  const a = document.createElement('a')
  a.href = getProjectExportUrl(project)
  a.download = `${project}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** 项目导入失败时抛出的错误：携带服务端返回的 HTTP 状态码与冲突项目名 */
export class ProjectImportError extends Error {
  /** 服务端 HTTP 状态码（如 409 表示项目已存在） */
  status?: number
  /** 冲突的项目名（服务端 409 响应体中返回，用于确认弹窗文案） */
  conflictName?: string

  /**
   * @param message 错误提示文案（优先取服务端返回的 error 字段）
   * @param status HTTP 状态码
   * @param conflictName 冲突的项目名
   */
  constructor(message: string, status?: number, conflictName?: string) {
    super(message)
    this.status = status
    this.conflictName = conflictName
  }
}

export interface ImportProjectOptions {
  /** 导入后的项目名；缺省时服务端自动识别（压缩包内单顶层目录名或文件名去 .zip） */
  name?: string
  /** 是否允许覆盖同名项目（默认 false；覆盖会删除现有项目数据，须先经用户确认） */
  overwrite?: boolean
  /** 上传进度回调（0-100 整数百分比） */
  onProgress?: (percent: number) => void
}

/**
 * 导入整个项目：上传 zip 压缩包，服务端解压到 design/ 下。
 * 项目已存在且未传 overwrite 时抛出 ProjectImportError（status 409，
 * conflictName 为冲突项目名）。
 *
 * @param file 项目 zip 文件
 * @param opts 导入选项
 * @returns 导入成功的项目名
 */
export async function importProject(
  file: File,
  opts: ImportProjectOptions = {},
): Promise<{ name: string }> {
  const form = new FormData()
  form.append('file', file)
  if (opts.name) form.append('name', opts.name)
  form.append('overwrite', opts.overwrite ? 'true' : 'false')
  try {
    const { data } = await client.post<{ name: string }>('/projects/import', form, {
      onUploadProgress: (e) => {
        if (e.total) opts.onProgress?.(Math.round((e.loaded / e.total) * 100))
      },
    })
    return data
  } catch (e) {
    const ax = e as AxiosError<{ error?: string; name?: string }>
    const message = ax.response?.data?.error || '导入失败，请稍后重试'
    throw new ProjectImportError(message, ax.response?.status, ax.response?.data?.name)
  }
}

export default client
