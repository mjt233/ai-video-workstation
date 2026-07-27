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

export default client
