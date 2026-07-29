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
