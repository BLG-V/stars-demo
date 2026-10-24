import 'dotenv/config'
import { createServer } from 'node:http'
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { URL } from 'node:url'
import { createJsonStorage } from './storage/json.mjs'
import { describeFileChanges, fileFingerprint } from './storage/file-changes.mjs'
import { authInput, planInput, runInput } from './schemas.mjs'

const scrypt = promisify(scryptCallback)
const port = Number(process.env.PORT || 8787)
const allowStub = process.env.ALLOW_STUB_MODEL === 'true'
const modelBaseUrl = process.env.MODEL_BASE_URL
const modelApiKey = process.env.MODEL_API_KEY
const modelName = process.env.MODEL_NAME
const configuredTimeoutMs = Number(process.env.MODEL_TIMEOUT_MS || 60000)
const modelTimeoutMs = Math.min(Math.max(Number.isFinite(configuredTimeoutMs) ? configuredTimeoutMs : 60000, 1000), 180000)
const modelConfigured = Boolean(modelBaseUrl && modelApiKey && modelName)
const cookieName = 'stars_session'
const dummyPasswordHash = 'scrypt$00000000000000000000000000000000$' + '0'.repeat(128)
const maxBodyBytes = 512 * 1024
const maxFileBytes = 256 * 1024
const maxProjectFiles = 50
const maxGeneratedBytes = 1024 * 1024
const maxModelResponseBytes = 2 * 1024 * 1024
const allowedFilePath = /^(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.(?:html?|css|js|mjs|json|md|svg)$/
const storageMode = process.env.STARS_STORAGE || 'json'
const dataFile = process.env.STARS_DATA_FILE || join(process.cwd(), 'data', 'stars.json')
if (!['json', 'mysql'].includes(storageMode)) throw new Error('STARS_STORAGE must be json or mysql')
const storage = storageMode === 'mysql'
  ? await (await import('./storage/mysql.mjs')).createMysqlStorage(process.env.DATABASE_URL)
  : createJsonStorage(dataFile)
const activeProjectRuns = new Set()
const now = () => new Date().toISOString()
const hashSessionToken = token => createHash('sha256').update(String(token)).digest('hex')
function json(res, status, value, extra = {}) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }); res.end(JSON.stringify(value)) }
function error(res, status, code, message) { if (res.audit) res.audit.errorCode = code; return json(res, status, { error: { code, message, requestId: res.getHeader('x-request-id') } }) }
function parseCookies(req) { const out = {}; for (const pair of (req.headers.cookie || '').split(';')) { const [key, ...rest] = pair.trim().split('='); if (key) out[key] = decodeURIComponent(rest.join('=') || '') }; return out }
function setSession(res, token, maxAge = 604800) { let value = cookieName + '=' + encodeURIComponent(token) + '; HttpOnly; Path=/; SameSite=Lax; Max-Age=' + maxAge; if (process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false')) value += '; Secure'; res.setHeader('set-cookie', value) }
async function readBody(req) { let total = 0; const chunks = []; for await (const chunk of req) { total += chunk.length; if (total > maxBodyBytes) throw new Error('BODY_TOO_LARGE'); chunks.push(chunk) }; if (!chunks.length) return {}; try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('INVALID_JSON') } }
async function hashPassword(password) { const salt = randomBytes(16).toString('hex'); const derived = await scrypt(password, salt, 64); return 'scrypt$' + salt + '$' + Buffer.from(derived).toString('hex') }
async function verifyPassword(password, encoded) { const parts = String(encoded).split('$'); const salt = parts[1]; const expected = parts[2]; if (!salt || !expected) return false; const actual = Buffer.from(await scrypt(password, salt, 64)); const target = Buffer.from(expected, 'hex'); return actual.length === target.length && timingSafeEqual(actual, target) }
function publicUser(user) { return { id: user.id, email: user.email, createdAt: user.createdAt } }
function safeRelativePath(value) {
  const path = String(value || '').replaceAll('\\', '/')
  if (path.length > 180 || path.startsWith('/') || path.includes('..') || !allowedFilePath.test(path)) return null
  return path
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]) }
async function getSession(req) { const token = parseCookies(req)[cookieName]; return token ? storage.findSession(hashSessionToken(token), now()) : null }
async function requireUser(req, res) { const current = await getSession(req); if (!current || !current.user) { error(res, 401, 'UNAUTHENTICATED', '请先登录'); return null }; return current.user }
function sseStart(res) { res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' }); res.write(': connected\n\n') }
function sse(res, event, id) { res.write('id: ' + id + '\nevent: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n') }
function runFiles(prompt) { const safePrompt = escapeHtml(String(prompt).slice(0, 500)); return [
  { path: 'index.html', content: '<main class="hero"><span class="eyebrow">STARS / 001</span><h1>你好，欢迎来到 Stars！</h1><p>' + safePrompt + '</p><button id="greeting">换一句欢迎语</button></main>' },
  { path: 'styles.css', content: ':root{font-family:system-ui;color:#0c0c0c}.hero{max-width:720px;margin:4rem auto;text-align:center}' },
  { path: 'app.js', content: "document.querySelector('#greeting')?.addEventListener('click',e=>e.currentTarget.previousElementSibling.previousElementSibling.textContent='让想法闪耀成真。')" },
  { path: 'README.md', content: '# Stars\\n\\nGenerated in local development mode.' }
] }
class GenerationError extends Error {
  constructor(code) { super(code); this.code = code }
}
function unsafeContent(content) {
  let normalized = content
  // Decode repeated representations before checking URL authorities, including IP/IPv6/localhost.
  for (let pass = 0; pass < 5; pass++) {
    const next = normalized.replace(/&amp;/gi, '&').replace(/&colon;/gi, ':').replace(/&sol;/gi, '/')
      .replace(/&#(x[0-9a-f]+|\d+);?/gi, (_, code) => {
        const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)
        return value <= 0x10ffff ? String.fromCodePoint(value) : ''
      })
      .replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, a, b, c) => {
        const value = parseInt(a || b || c, 16)
        return value <= 0x10ffff ? String.fromCodePoint(value) : ''
      }).replace(/%([0-9a-f]{2})/gi, (_, code) => String.fromCharCode(parseInt(code, 16))).replace(/\\\//g, '/')
    if (next === normalized) break
    normalized = next
  }
  // Special URLs discard TAB/CR/LF and treat backslashes as slashes in browsers.
  normalized = normalized.replace(/[\t\r\n]/g, '').replaceAll('\\', '/')
    .replace(/xmlns\s*=\s*(['"])http:\/\/www\.w3\.org\/2000\/svg\1/gi, '')
  return /https?:|(?<!:)\/\/[a-z0-9[]/i.test(normalized) || /\batoms\b/i.test(normalized)
}
function reviewChanges(before, after, runId) {
  return describeFileChanges(before, after, runId).map(change => ({ ...change,
    before: before.find(file => file.path === change.path)?.content || '',
    after: after.find(file => file.path === change.path)?.content || '',
  }))
}
function validateGeneratedFiles(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.files) || value.files.length === 0 || value.files.length > maxProjectFiles) throw new GenerationError('MODEL_INVALID_OUTPUT')
  const seen = new Set()
  const files = []
  let totalBytes = 0
  for (const item of value.files) {
    if (!item || typeof item !== 'object' || typeof item.path !== 'string' || typeof item.content !== 'string') throw new GenerationError('MODEL_INVALID_OUTPUT')
    const path = safeRelativePath(item.path)
    if (!path || seen.has(path)) throw new GenerationError('MODEL_INVALID_OUTPUT')
    const size = Buffer.byteLength(item.content, 'utf8')
    totalBytes += size
    if (size > maxFileBytes || totalBytes > maxGeneratedBytes) throw new GenerationError('MODEL_OUTPUT_TOO_LARGE')
    if (unsafeContent(item.content)) throw new GenerationError('UNSAFE_GENERATED_CONTENT')
    seen.add(path)
    files.push({ path, content: item.content })
  }
  if (!seen.has('index.html')) throw new GenerationError('MODEL_INVALID_OUTPUT')
  return files
}
async function readLimited(response, limit) {
  if (!response.body) throw new GenerationError('MODEL_INVALID_OUTPUT')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel(); throw new GenerationError('MODEL_OUTPUT_TOO_LARGE') }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks).toString('utf8')
}
async function generateWithModel(prompt, currentFiles) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), modelTimeoutMs)
  try {
    const response = await fetch(modelBaseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { authorization: 'Bearer ' + modelApiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You are Stars, a coding agent. Return only one JSON object in the exact shape {"files":[{"path":"index.html","content":"..."}]}. Include every complete file needed to run the app. Use only safe relative paths and local assets. Do not include external URLs or the word Atoms. Never return markdown fences or commentary.' },
          { role: 'user', content: JSON.stringify({ request: prompt, currentFiles: currentFiles.map(({ path, content }) => ({ path, content })) }) },
        ],
      }),
    })
    if (!response.ok) throw new GenerationError('MODEL_PROVIDER_ERROR')
    let envelope
    try { envelope = JSON.parse(await readLimited(response, maxModelResponseBytes)) } catch (error) { if (error instanceof GenerationError) throw error; throw new GenerationError('MODEL_PROVIDER_ERROR') }
    const content = envelope?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new GenerationError('MODEL_INVALID_OUTPUT')
    let output
    try { output = JSON.parse(content) } catch { throw new GenerationError('MODEL_INVALID_OUTPUT') }
    return validateGeneratedFiles(output)
  } catch (error) {
    if (error instanceof GenerationError) throw error
    if (error?.name === 'AbortError') throw new GenerationError('MODEL_TIMEOUT')
    throw new GenerationError('MODEL_PROVIDER_ERROR')
  } finally { clearTimeout(timeout) }
}
function generationErrorSummary(code) {
  return ({
    MODEL_TIMEOUT: '模型服务响应超时，请稍后重试。',
    MODEL_PROVIDER_ERROR: '模型服务暂时不可用，请稍后重试。',
    MODEL_INVALID_OUTPUT: '模型返回格式无效，请重试。',
    MODEL_OUTPUT_TOO_LARGE: '生成内容超过允许大小，请缩小需求后重试。',
    UNSAFE_GENERATED_CONTENT: '生成内容包含不允许的外链或品牌标识，请修改需求后重试。',
  })[code] || '生成失败，请重试。'
}
async function handle(req, res) {
  let streamStarted = false
  const startedAt = Date.now()
  res.audit = { requestId: randomUUID(), method: req.method, status: null }
  res.setHeader('x-request-id', res.audit.requestId)
  res.once('finish', () => console.log(JSON.stringify({ ...res.audit, status: res.statusCode, durationMs: Date.now() - startedAt })))
  const origin = req.headers.origin
  if (origin && (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1'))) { res.setHeader('access-control-allow-origin', origin); res.setHeader('access-control-allow-credentials', 'true') }
  res.setHeader('access-control-allow-headers', 'content-type,last-event-id'); res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  const url = new URL(req.url, 'http://localhost:' + port)
  if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, storage: storage.kind, stubModel: allowStub })
  try {
    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      const parsed = authInput.safeParse(await readBody(req))
      if (!parsed.success) return error(res, 400, 'REGISTRATION_ERROR', '注册信息不可用，请检查输入或尝试登录')
      const { email, password } = parsed.data
      if (await storage.findUserByEmail(email)) { await hashPassword(password); return error(res, 400, 'REGISTRATION_ERROR', '注册信息不可用，请检查输入或尝试登录') }
      const user = { id: randomUUID(), email, passwordHash: await hashPassword(password), createdAt: now(), updatedAt: now() }
      const token = randomBytes(32).toString('hex'); const createdUser = await storage.createUserAndSession(user, { id: randomUUID(), token: hashSessionToken(token), userId: user.id, expiresAt: new Date(Date.now() + 604800000).toISOString(), createdAt: now() })
      if (!createdUser) return error(res, 400, 'REGISTRATION_ERROR', '注册信息不可用，请检查输入或尝试登录')
      setSession(res, token)
      return json(res, 201, { user: publicUser(user) })
    }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req); const email = String(body.email || '').trim().toLowerCase(); const user = await storage.findUserByEmail(email)
      const passwordValid = await verifyPassword(String(body.password || ''), user?.passwordHash || dummyPasswordHash)
      if (!user || !passwordValid) return error(res, 401, 'INVALID_CREDENTIALS', '邮箱或密码错误')
      const token = randomBytes(32).toString('hex'); await storage.createSession({ id: randomUUID(), token: hashSessionToken(token), userId: user.id, expiresAt: new Date(Date.now() + 604800000).toISOString(), createdAt: now() }); setSession(res, token)
      return json(res, 200, { user: publicUser(user) })
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') { const token = parseCookies(req)[cookieName]; if (token) await storage.deleteSession(hashSessionToken(token)); setSession(res, '', 0); return json(res, 200, { ok: true }) }
    if (url.pathname === '/api/me' && req.method === 'GET') { const current = await getSession(req); return current && current.user ? json(res, 200, { user: publicUser(current.user) }) : error(res, 401, 'UNAUTHENTICATED', '请先登录') }
    const user = await requireUser(req, res); if (!user) return
    res.audit.userHash = hashSessionToken(user.id).slice(0, 16)
    if (url.pathname === '/api/projects' && req.method === 'GET') return json(res, 200, { projects: await storage.listProjects(user.id) })
    if (url.pathname === '/api/projects' && req.method === 'POST') { const body = await readBody(req); const name = String(body.name || '未命名项目').trim().slice(0, 80); const prompt = String(body.initialPrompt || '').trim().slice(0, 4000); const project = { id: randomUUID(), ownerId: user.id, name, initialPrompt: prompt, status: 'empty', createdAt: now(), updatedAt: now(), deletedAt: null }; await storage.createProject(project); return json(res, 201, { project }) }
    const restoreMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/snapshots\/([^/]+)\/restore$/)
    if (restoreMatch && req.method === 'POST') {
      const project = await storage.getOwnedProject(user.id, restoreMatch[1]); if (!project) return error(res, 404, 'NOT_FOUND', '资源不存在')
      if ((await storage.getProjectData(project.id)).runs.some(run => ['running', 'review'].includes(run.status))) return error(res, 409, 'PROJECT_BUSY', '请先完成或放弃当前生成审核')
      const snapshot = await storage.getSnapshot(project.id, restoreMatch[2])
      if (!snapshot) return error(res, 404, 'NOT_FOUND', '快照不存在')
      if (!Array.isArray(snapshot.manifest) || snapshot.manifest.length > maxProjectFiles) return error(res, 422, 'INVALID_SNAPSHOT', '快照文件数量无效')
      const restored = []
      for (const file of snapshot.manifest) {
        const path = safeRelativePath(file.path); const content = String(file.content || '')
        if (!path || Buffer.byteLength(content, 'utf8') > maxFileBytes) return error(res, 422, 'INVALID_SNAPSHOT', '快照包含不安全文件')
        restored.push({ id: randomUUID(), projectId: project.id, path, content, contentHash: String(file.contentHash || randomBytes(16).toString('hex')), updatedByRunId: null, updatedAt: now() })
      }
      try { validateGeneratedFiles({ files: restored }) } catch { return error(res, 422, 'INVALID_SNAPSHOT', '快照内容未通过文件安全校验') }
      const updatedProject = await storage.restoreProject(project.id, restored, now())
      return json(res, 200, { project: updatedProject, snapshotId: snapshot.id, files: restored })
    }
    const approvalMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/runs\/([^/]+)\/(approve|reject)$/)
    if (approvalMatch && req.method === 'POST') {
      const project = await storage.getOwnedProject(user.id, approvalMatch[1])
      if (!project) return error(res, 404, 'NOT_FOUND', '资源不存在')
      res.audit.projectId = project.id
      const run = (await storage.getProjectData(project.id)).runs.find(item => item.id === approvalMatch[2])
      if (!run) return error(res, 404, 'NOT_FOUND', '运行不存在')
      res.audit.runId = run.id
      res.audit.runStatus = run.status
      if (approvalMatch[3] === 'approve') {
        if (run.status !== 'done') {
          if (run.status !== 'review') return error(res, 409, 'RUN_NOT_REVIEWABLE', '运行当前不能批准')
          const files = validateGeneratedFiles({ files: run.details.candidateFiles })
            .map(file => ({ ...run.details.candidateFiles.find(item => item.path === file.path), ...file }))
          const result = await storage.commitReviewedRun(project.id, run.id, run.details.baseHash, files, now())
          if (result !== 'done') return error(res, 409, result === 'stale' ? 'PLAN_STALE' : 'RUN_NOT_REVIEWABLE', '项目文件已经变化，请放弃当前候选并重新规划')
        }
      } else if (run.status !== 'rejected') {
        if (run.status !== 'review') return error(res, 409, 'RUN_NOT_REVIEWABLE', '运行当前不能放弃')
        const details = { ...run.details, plan: { ...run.details.plan, status: 'rejected' } }
        delete details.candidateFiles
        if (!await storage.saveRunState(run.id, 'rejected', details, now(), 'review')) return error(res, 409, 'RUN_NOT_REVIEWABLE', '运行状态已变化')
      }
      res.audit.runStatus = approvalMatch[3] === 'approve' ? 'done' : 'rejected'
      return json(res, 200, { project: await storage.getOwnedProject(user.id, project.id), ...await storage.getProjectData(project.id) })
    }
    const match = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(files|messages|plans|runs|snapshots))?$/)
    if (match) {
      const project = await storage.getOwnedProject(user.id, match[1]); if (!project) return error(res, 404, 'NOT_FOUND', '资源不存在'); const sub = match[2]
      res.audit.projectId = project.id
      if (!sub && req.method === 'PATCH') {
        const body = await readBody(req); const name = String(body.name || '').trim()
        if (!name || name.length > 80) return error(res, 400, 'INVALID_INPUT', '项目名称不能为空且不得超过 80 个字符')
        const updated = await storage.updateProject(user.id, project.id, name, now())
        return updated ? json(res, 200, { project: updated }) : error(res, 404, 'NOT_FOUND', '资源不存在')
      }
      if (!sub && req.method === 'DELETE') {
        if (activeProjectRuns.has(project.id)) return error(res, 409, 'RUN_ALREADY_ACTIVE', '项目生成任务运行期间不能删除')
        const deleted = await storage.deleteProject(user.id, project.id, now())
        return deleted ? json(res, 200, { project: deleted }) : error(res, 404, 'NOT_FOUND', '资源不存在')
      }
      if (!sub && req.method === 'GET') return json(res, 200, { project, ...await storage.getProjectData(project.id) })
      if (sub === 'files' && req.method === 'PUT') {
        if (activeProjectRuns.has(project.id)) return error(res, 409, 'RUN_ALREADY_ACTIVE', '项目生成任务运行期间不能编辑文件')
        const body = await readBody(req); const path = safeRelativePath(body.path)
        if (!path || typeof body.content !== 'string') return error(res, 400, 'INVALID_INPUT', '文件路径或内容无效')
        const size = Buffer.byteLength(body.content, 'utf8')
        if (size > maxFileBytes) return error(res, 413, 'FILE_TOO_LARGE', '单个文件不得超过 256 KiB')
        if (unsafeContent(body.content)) return error(res, 422, 'UNSAFE_FILE_CONTENT', '文件包含不允许的外链或平台品牌标识')
        const files = (await storage.getProjectData(project.id)).files
        const previous = files.find(file => file.path === path)
        if (!previous && files.length >= maxProjectFiles) return error(res, 413, 'PROJECT_FILE_LIMIT', '项目文件数量已达上限')
        const totalBytes = files.reduce((total, file) => total + Buffer.byteLength(file.content, 'utf8'), 0) - (previous ? Buffer.byteLength(previous.content, 'utf8') : 0) + size
        if (totalBytes > maxGeneratedBytes) return error(res, 413, 'PROJECT_SIZE_LIMIT', '项目文件总大小超过 1 MiB')
        const file = await storage.saveProjectFile(project.id, { id: randomUUID(), projectId: project.id, path, content: body.content, contentHash: createHash('sha256').update(body.content).digest('hex'), updatedByRunId: null }, now())
        return json(res, 200, { file })
      }
      if (sub && req.method === 'GET') { const data = await storage.getProjectData(project.id); if (sub === 'files') return json(res, 200, { files: data.files }); if (sub === 'messages') return json(res, 200, { messages: data.messages }); if (sub === 'runs') return json(res, 200, { runs: data.runs }); if (sub === 'snapshots') return json(res, 200, { snapshots: data.snapshots }) }
      if (sub === 'snapshots' && req.method === 'POST') {
        const body = await readBody(req)
        const snapshot = await storage.createSnapshot({ id: randomUUID(), projectId: project.id, name: String(body.name || '当前版本').slice(0, 80), createdBy: user.id, createdAt: now() })
        return json(res, 201, { snapshot })
      }
      if (sub === 'plans' && req.method === 'POST') {
        const parsed = planInput.safeParse(await readBody(req))
        if (!parsed.success) return error(res, 400, 'INVALID_INPUT', '需求不能为空且不得超过 4000 个字符')
        const data = await storage.getProjectData(project.id)
        if (data.runs.some(run => ['running', 'review'].includes(run.status))) return error(res, 409, 'RUN_ALREADY_ACTIVE', '请先完成或放弃当前生成审核')
        const plan = { id: randomUUID(), prompt: parsed.data.prompt, status: 'planned',
          summary: `需求：${parsed.data.prompt}\n执行方案：生成可在沙箱中运行的 HTML/CSS/JavaScript 页面，实现需求中的交互；保留当前项目上下文；禁止外部资源和服务器命令。\n此为规则生成的执行范围，最终文件和差异将在写入前单独审核。`,
          files: [...new Set(['index.html', 'styles.css', 'app.js', ...data.files.map(file => file.path)])].map(path => ({ path, operation: data.files.some(file => file.path === path) ? 'review' : 'create' })),
        }
        const run = { id: plan.id, projectId: project.id, status: 'planned', model: modelConfigured ? modelName : 'local-stub', promptHash: hashSessionToken(parsed.data.prompt), createdAt: now(), updatedAt: now(), errorCode: null, details: { plan, baseHash: fileFingerprint(data.files), events: [] } }
        await storage.startRun(project.id, run, { id: randomUUID(), projectId: project.id, role: 'user', content: parsed.data.prompt, runId: run.id, createdAt: now() })
        return json(res, 201, { plan })
      }
      if (sub === 'runs' && req.method === 'POST') {
        if (!modelConfigured && !allowStub) return error(res, 503, 'MODEL_NOT_CONFIGURED', '真实模型服务尚未配置，开发模式请显式设置 ALLOW_STUB_MODEL=true')
        const parsed = runInput.safeParse(await readBody(req))
        if (!parsed.success || parsed.data.idempotencyKey !== parsed.data.planId) return error(res, 400, 'PLAN_REQUIRED', '请先查看并确认生成计划')
        let run = (await storage.getProjectData(project.id)).runs.find(item => item.id === parsed.data.planId)
        if (!run?.details?.plan) return error(res, 404, 'NOT_FOUND', '生成计划不存在')
        res.audit.runId = run.id
        res.audit.runStatus = run.status
        const lastEventId = Number(req.headers['last-event-id'] || 0)
        if (!Number.isSafeInteger(lastEventId) || lastEventId < 0) return error(res, 400, 'INVALID_EVENT_ID', '事件编号无效')
        if (run.status === 'planned') {
          const claimed = await storage.claimRun(project.id, run.id, now())
          if (claimed) run = claimed
          else run = (await storage.getProjectData(project.id)).runs.find(item => item.id === run.id)
          if (!claimed && run.status === 'planned') return error(res, 409, 'RUN_ALREADY_ACTIVE', '该项目已有生成任务正在运行')
          if (claimed) {
            activeProjectRuns.add(project.id)
            sseStart(res); streamStarted = true
            const emit = async (type, summary, extra = {}, status = 'running') => {
              const event = { id: run.details.events.length + 1, type, summary, runId: run.id, createdAt: now(), devMode: !modelConfigured, ...extra }
              run.details.events.push(event)
              await storage.saveRunState(run.id, status, run.details, now())
              res.audit.runStatus = status
              if (extra.errorCode) res.audit.errorCode = extra.errorCode
              if (!res.destroyed) sse(res, event, event.id)
            }
            try {
              const currentFiles = (await storage.getProjectData(project.id)).files
              if (fileFingerprint(currentFiles) !== run.details.baseHash) throw new GenerationError('PLAN_STALE')
              await emit('queued', '生成计划已确认，任务已入队')
              await emit('planning', run.details.plan.summary)
              if (currentFiles.length) await emit('read_file', `读取当前项目 ${currentFiles.length} 个文件作为修改上下文`)
              await emit('generating', modelConfigured ? '智能体正在生成候选文件' : '开发模式 Stub 正在生成候选示例')
              // Continue after a disconnected response: the same plan can replay persisted events.
              const generated = modelConfigured ? await generateWithModel(run.details.plan.prompt, currentFiles) : validateGeneratedFiles({ files: runFiles(run.details.plan.prompt) })
              await emit('validating', '校验文件路径、大小、外链和品牌规则；浏览器交互需在预览中验证')
              const updatedFiles = generated.map(file => ({ ...file, id: randomUUID(), projectId: project.id, contentHash: hashSessionToken(file.content), updatedByRunId: run.id, updatedAt: now() }))
              const changes = reviewChanges(currentFiles, updatedFiles, run.id)
              for (const change of changes) await emit('file_change', `${change.operation}: ${change.path}`, { path: change.path, operation: change.operation })
              run.details.candidateFiles = updatedFiles
              run.details.changes = changes
              await emit('review', '候选文件已生成，确认差异后才会写入项目', { changes }, 'review')
            } catch (generationError) {
              const code = generationError instanceof GenerationError ? generationError.code : 'MODEL_PROVIDER_ERROR'
              await emit('error', code === 'PLAN_STALE' ? '项目文件已变化，请重新创建生成计划。' : generationErrorSummary(code), { errorCode: code }, 'failed')
            } finally {
              activeProjectRuns.delete(project.id)
              console.log(JSON.stringify({ ...res.audit, event: 'run_finished', durationMs: Date.now() - startedAt }))
              if (!res.destroyed) res.end()
            }
            return
          }
        }
        sseStart(res); streamStarted = true
        for (const event of run.details.events || []) if (event.id > lastEventId) sse(res, event, event.id)
        res.end()
        return
      }
    }
    return error(res, 404, 'NOT_FOUND', '接口不存在')
  } catch (err) { if (streamStarted) { if (!res.destroyed) { sse(res, { type: 'error', summary: '生成失败，请重试。', errorCode: 'INTERNAL_ERROR' }, 1); res.end() }; return }; if (err?.code === 'PROJECT_BUSY') return error(res, 409, 'PROJECT_BUSY', '请先完成或放弃当前生成审核'); if (err && err.message === 'BODY_TOO_LARGE') return error(res, 413, 'BODY_TOO_LARGE', '请求体过大'); if (err && err.message === 'INVALID_JSON') return error(res, 400, 'INVALID_JSON', '请求格式错误'); return error(res, 500, 'INTERNAL_ERROR', '服务暂时不可用') }
}
await storage.initialize()
await storage.interruptRuns(now())
createServer(handle).listen(port, '127.0.0.1', () => console.log('Stars API listening on http://127.0.0.1:' + port))
