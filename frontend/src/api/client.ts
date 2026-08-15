import axios from 'axios'

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

export default client
