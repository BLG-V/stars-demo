import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { describeFileChanges, fileFingerprint } from './file-changes.mjs'

const emptyDb = () => ({ users: [], sessions: [], projects: [], files: [], messages: [], runs: [], fileChanges: [], snapshots: [] })
const copy = value => structuredClone(value)
const requireIdleProject = (state, projectId) => {
  if (state.runs.some(run => run.projectId === projectId && ['running', 'review'].includes(run.status))) throw Object.assign(new Error('Project has an active run'), { code: 'PROJECT_BUSY' })
}

export function createJsonStorage(dataFile) {
  let db = emptyDb()
  let writeQueue = Promise.resolve()
  let mutationQueue = Promise.resolve()

  async function initialize() {
    await mkdir(dirname(dataFile), { recursive: true })
    if (!existsSync(dataFile)) return
    try { db = { ...emptyDb(), ...JSON.parse(await readFile(dataFile, 'utf8')) } } catch { db = emptyDb() }
  }
  function persist(state) {
    const serialized = JSON.stringify(state, null, 2)
    const tempFile = dataFile + '.' + randomUUID() + '.tmp'
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      try { await writeFile(tempFile, serialized, 'utf8'); await rename(tempFile, dataFile) }
      catch (error) { await rm(tempFile, { force: true }).catch(() => {}); throw error }
    })
    return writeQueue
  }
  async function mutate(update) {
    const mutation = mutationQueue.catch(() => {}).then(async () => {
      const next = copy(db)
      const result = update(next)
      await persist(next)
      db = next
      return copy(result)
    })
    mutationQueue = mutation.then(() => undefined, () => undefined)
    return mutation
  }
  return {
    kind: 'json', initialize,
    async findUserByEmail(email) { return copy(db.users.find(user => user.email === email) || null) },
    async createUserAndSession(user, session) { return mutate(state => { if (state.users.some(item => item.email === user.email)) return null; state.users.push(user); state.sessions.push(session); return user }) },
    async findSession(token, at) {
      const session = db.sessions.find(item => item.token === token && item.expiresAt > at)
      if (!session) return null
      return { session: copy(session), user: copy(db.users.find(item => item.id === session.userId) || null) }
    },
    async createSession(session) { return mutate(state => { state.sessions.push(session); return session }) },
    async deleteSession(token) { return mutate(state => { state.sessions = state.sessions.filter(item => item.token !== token) }) },
    async listProjects(userId) { return copy(db.projects.filter(item => item.ownerId === userId && !item.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) },
    async createProject(project) { return mutate(state => { state.projects.push(project); return project }) },
    async updateProject(userId, projectId, name, at) {
      return mutate(state => {
        const project = state.projects.find(item => item.id === projectId && item.ownerId === userId && !item.deletedAt)
        if (!project) return null
        project.name = name
        project.updatedAt = at
        return project
      })
    },
    async deleteProject(userId, projectId, at) {
      return mutate(state => {
        const project = state.projects.find(item => item.id === projectId && item.ownerId === userId && !item.deletedAt)
        if (!project) return null
        requireIdleProject(state, projectId)
        project.deletedAt = at
        project.updatedAt = at
        return project
      })
    },
    async getOwnedProject(userId, projectId) { return copy(db.projects.find(item => item.id === projectId && item.ownerId === userId && !item.deletedAt) || null) },
    async getProjectData(projectId) {
      return { files: copy(db.files.filter(item => item.projectId === projectId)), messages: copy(db.messages.filter(item => item.projectId === projectId)), runs: copy(db.runs.filter(item => item.projectId === projectId)), snapshots: copy(db.snapshots.filter(item => item.projectId === projectId)) }
    },
    async saveProjectFile(projectId, file, at) {
      return mutate(state => {
        requireIdleProject(state, projectId)
        const existing = state.files.find(item => item.projectId === projectId && item.path === file.path)
        if (existing) Object.assign(existing, file, { updatedAt: at })
        else state.files.push({ ...file, id: randomUUID(), projectId, updatedAt: at })
        const project = state.projects.find(item => item.id === projectId)
        project.updatedAt = at
        return existing || state.files[state.files.length - 1]
      })
    },
    async createSnapshot(snapshot) {
      return mutate(state => {
        const files = state.files.filter(item => item.projectId === snapshot.projectId)
        const record = { ...snapshot, manifest: files.slice(0, 50).map(({ path, content, contentHash }) => ({ path, content, contentHash })) }
        state.snapshots.push(record)
        return record
      })
    },
    async getSnapshot(projectId, snapshotId) { return copy(db.snapshots.find(item => item.projectId === projectId && item.id === snapshotId) || null) },
    async restoreProject(projectId, restoredFiles, at) {
      return mutate(state => {
        requireIdleProject(state, projectId)
        const project = state.projects.find(item => item.id === projectId)
        state.files = state.files.filter(item => item.projectId !== projectId).concat(restoredFiles)
        project.status = 'ready'; project.updatedAt = at
        return project
      })
    },
    async startRun(projectId, run, message) {
      return mutate(state => { state.runs.push(copy(run)); state.messages.push(copy(message)) })
    },
    async claimRun(projectId, runId, at) {
      return mutate(state => {
        if (!state.projects.some(item => item.id === projectId && !item.deletedAt)) return null
        const run = state.runs.find(item => item.id === runId && item.projectId === projectId)
        if (!run || run.status !== 'planned' || state.runs.some(item => item.projectId === projectId && item.id !== runId && ['running', 'review'].includes(item.status))) return null
        run.status = 'running'; run.updatedAt = at
        return run
      })
    },
    async saveRunState(runId, status, details, at, expectedStatus) {
      return mutate(state => {
        const run = state.runs.find(item => item.id === runId)
        if (!run || (expectedStatus && run.status !== expectedStatus)) return false
        const errorCode = status === 'failed' ? details.events?.findLast(event => event.type === 'error')?.errorCode || null : status === 'rejected' ? 'RUN_REJECTED' : null
        Object.assign(run, { status, details: copy(details), errorCode, updatedAt: at })
        return true
      })
    },
    async commitReviewedRun(projectId, runId, baseHash, files, at) {
      return mutate(state => {
        if (!state.projects.some(item => item.id === projectId && !item.deletedAt)) return 'invalid'
        const run = state.runs.find(item => item.id === runId && item.projectId === projectId)
        if (run?.status === 'done') return 'done'
        if (run?.status !== 'review') return 'invalid'
        const previousFiles = state.files.filter(item => item.projectId === projectId)
        if (fileFingerprint(previousFiles) !== baseHash) return 'stale'
        state.fileChanges.push(...describeFileChanges(previousFiles, files, runId))
        state.files = state.files.filter(item => item.projectId !== projectId).concat(copy(files))
        run.status = 'done'; run.updatedAt = at
        run.details ||= {}; run.details.events ||= []
        run.details.events.push({ id: Math.max(0, ...run.details.events.map(event => Number(event.id) || 0)) + 1, type: 'done', runId, summary: '变更已确认并保存', createdAt: at, devMode: run.model === 'local-stub' })
        if (run.details.plan) run.details.plan.status = 'done'
        delete run.details.candidateFiles
        Object.assign(state.projects.find(item => item.id === projectId), { status: 'ready', updatedAt: at })
        return 'done'
      })
    },
    async interruptRuns(at) {
      return mutate(state => {
        let count = 0
        for (const run of state.runs.filter(item => item.status === 'running')) {
          run.status = 'failed'; run.errorCode = 'RUN_INTERRUPTED'; run.updatedAt = at
          run.details ||= {}; run.details.events ||= []
          run.details.events.push({ id: Math.max(0, ...run.details.events.map(event => Number(event.id) || 0)) + 1, type: 'error', errorCode: 'RUN_INTERRUPTED', summary: '服务重启，运行已中断；请创建新计划重试。', runId: run.id, createdAt: at, devMode: run.model === 'local-stub' })
          count++
        }
        return count
      })
    },
    async completeRun(projectId, runId, files, at) {
      return mutate(state => {
        const previousFiles = state.files.filter(item => item.projectId === projectId)
        state.fileChanges.push(...describeFileChanges(previousFiles, files, runId))
        state.files = state.files.filter(item => item.projectId !== projectId).concat(files)
        const run = state.runs.find(item => item.id === runId)
        const project = state.projects.find(item => item.id === projectId)
        run.status = 'done'; run.updatedAt = at; project.status = 'ready'; project.updatedAt = at
      })
    },
    async failRun(runId, errorCode, at) {
      return mutate(state => { const run = state.runs.find(item => item.id === runId); run.status = 'failed'; run.errorCode = errorCode; run.updatedAt = at })
    },
  }
}
