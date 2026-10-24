const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) {
    const message = typeof body === 'object' && body?.error?.message ? body.error.message : `请求失败（${response.status}）`
    const error = new Error(message)
    error.status = response.status
    throw error
  }
  return body
}

export function getSession() { return request('/me') }
export function login(email, password) { return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }) }
export function register(email, password) { return request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }) }
export function logout() { return request('/auth/logout', { method: 'POST', body: '{}' }) }
export function listProjects() { return request('/projects') }
export function createProject(name, initialPrompt) { return request('/projects', { method: 'POST', body: JSON.stringify({ name, initialPrompt }) }) }
export function getProject(projectId) { return request(`/projects/${projectId}`) }
export function updateProject(projectId, name) { return request(`/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ name }) }) }
export function deleteProject(projectId) { return request(`/projects/${projectId}`, { method: 'DELETE' }) }
export function saveProjectFile(projectId, path, content) { return request(`/projects/${projectId}/files`, { method: 'PUT', body: JSON.stringify({ path, content }) }) }
export function createSnapshot(projectId, name) { return request(`/projects/${projectId}/snapshots`, { method: 'POST', body: JSON.stringify({ name }) }) }
export function restoreSnapshot(projectId, snapshotId) { return request(`/projects/${projectId}/snapshots/${snapshotId}/restore`, { method: 'POST', body: '{}' }) }
export function planProject(projectId, prompt) { return request(`/projects/${projectId}/plans`, { method: 'POST', body: JSON.stringify({ prompt }) }) }
export function approveRun(projectId, runId) { return request(`/projects/${projectId}/runs/${runId}/approve`, { method: 'POST', body: '{}' }) }
export function rejectRun(projectId, runId) { return request(`/projects/${projectId}/runs/${runId}/reject`, { method: 'POST', body: '{}' }) }

export async function runProject(projectId, planId, onEvent, options = {}) {
  let lastEventId = String(options.lastEventId || '')
  let terminal = false
  let networkFailures = 0
  const deadline = Date.now() + 240000
  const controller = new AbortController()
  let timedOut = false
  const cancel = () => controller.abort()
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) cancel()
  const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 240000)
  try {
  while (!terminal && Date.now() < deadline) {
    try {
      if (controller.signal.aborted) throw new DOMException('运行观察已中止', 'AbortError')
      const response = await fetch(`${API_BASE}/projects/${projectId}/runs`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}) },
    body: JSON.stringify({ planId, idempotencyKey: planId }),
    signal: controller.signal,
  })
  if (!response.ok) {
    const contentType = response.headers.get('content-type') || ''
    const body = contentType.includes('application/json') ? await response.json() : null
    const error = new Error(body?.error?.message || `运行失败（${response.status}）`)
    error.status = response.status
    error.code = body?.error?.code
    throw error
  }
  if (!response.body) throw new Error('生成流不可用，请重新打开项目查看状态。')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n')
    if (done && buffer.trim()) buffer += '\n\n'
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() || ''
    for (const chunk of chunks) {
      const data = chunk.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim()
      if (!data) continue
      let event
      try { event = JSON.parse(data) } catch { continue }
      const eventId = event.id || chunk.split('\n').find(line => line.startsWith('id:'))?.slice(3).trim()
      if (eventId && Number(eventId) <= Number(lastEventId || 0)) continue
      if (eventId) lastEventId = String(eventId)
      terminal = ['review', 'done', 'error'].includes(event.type)
      onEvent(event)
    }
    if (done) break
  }
      networkFailures = 0
    } catch (error) {
      if (controller.signal.aborted) {
        if (timedOut) throw new Error('等待生成结果超时，请重新连接查看保存的运行状态。')
        throw error
      }
      if (error.status || ++networkFailures > 3) throw error
    }
    if (!terminal) await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!terminal) throw new Error('等待生成结果超时，请重新打开项目查看保存的运行状态。')
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', cancel)
  }
}
