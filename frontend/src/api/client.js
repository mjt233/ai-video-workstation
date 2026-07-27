import axios from 'axios'

const client = axios.create({ baseURL: '/api' })

export async function getProjects() {
  const { data } = await client.get('/projects')
  return data
}

export async function readFs(project, path) {
  const { data } = await client.get(`/fs/${project}/${path}`)
  return data
}

export async function writeFs(project, path, content) {
  const { data } = await client.post(`/fs/${project}/${path}`, { content })
  return data
}

export default client
