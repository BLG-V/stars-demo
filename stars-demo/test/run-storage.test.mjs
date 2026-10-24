import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJsonStorage } from '../server/storage/json.mjs'
import { createMysqlStorage } from '../server/storage/mysql.mjs'
import { fileFingerprint } from '../server/storage/file-changes.mjs'

const at = '2026-10-23T00:00:00.000Z'
const file = (content = 'old') => ({ id: 'f1', projectId: 'p1', path: 'index.html', content, contentHash: content, updatedByRunId: null, updatedAt: at })
const run = (id, status = 'planned') => ({ id, projectId: 'p1', status, model: 'local-stub', promptHash: 'prompt', errorCode: null, createdAt: at, updatedAt: at, details: { plan: { id, prompt: 'Build a counter', status: 'planned' }, events: [] } })
const message = id => ({ id: 'm-' + id, projectId: 'p1', role: 'user', content: 'Build a counter', runId: id, createdAt: at })

async function jsonFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'stars-run-storage-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'db.json'), storage = createJsonStorage(path)
  await storage.initialize()
  await storage.createProject({ id: 'p1', ownerId: 'u1', name: 'Counter', status: 'ready', updatedAt: at })
  await storage.saveProjectFile('p1', file(), at)
  return { storage, path }
}

test('persisted plans survive reload, with one claim per project and no replay generation claim', async t => {
  const { storage, path } = await jsonFixture(t)
  await storage.startRun('p1', run('r1'), message('r1'))
  await storage.startRun('p1', run('r2'), message('r2'))
  const resumed = createJsonStorage(path)
  await resumed.initialize()
  assert.equal((await resumed.getProjectData('p1')).runs[0].details.plan.prompt, 'Build a counter')
  const claims = await Promise.all([resumed.claimRun('p1', 'r1', at), resumed.claimRun('p1', 'r2', at)])
  assert.equal(claims.filter(Boolean).length, 1)
  assert.equal(await resumed.claimRun('p1', claims.find(Boolean).id, at), null)
  const id = claims.find(Boolean).id
  await resumed.saveRunState(id, 'review', { events: [{ id: 1, type: 'review' }], candidateFiles: [file('new')] }, at)
  assert.equal(await resumed.claimRun('p1', id === 'r1' ? 'r2' : 'r1', at), null)
  for (const mutation of [() => resumed.saveProjectFile('p1', file('conflict'), at), () => resumed.restoreProject('p1', [], at), () => resumed.deleteProject('u1', 'p1', at)]) {
    await assert.rejects(mutation(), { code: 'PROJECT_BUSY' })
  }
  assert.equal((await resumed.getProjectData('p1')).files[0].content, 'old')
})

test('review approval atomically saves files, audit and final replay event exactly once', async t => {
  const { storage, path } = await jsonFixture(t)
  const planned = run('r1'), before = (await storage.getProjectData('p1')).files
  planned.details.baseHash = fileFingerprint(before)
  await storage.startRun('p1', planned, message('r1'))
  await storage.claimRun('p1', 'r1', at)
  await storage.saveRunState('r1', 'review', { ...planned.details, events: [{ id: 7, type: 'review' }], candidateFiles: [file('new')] }, at)
  assert.equal(await storage.commitReviewedRun('p1', 'r1', planned.details.baseHash, [file('new')], at), 'done')
  assert.equal(await storage.commitReviewedRun('p1', 'r1', planned.details.baseHash, [file('different')], at), 'done')
  assert.equal(await storage.saveRunState('r1', 'rejected', {}, at, 'review'), false)
  const saved = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(saved.files[0].content, 'new')
  assert.equal(saved.fileChanges.length, 1)
  assert.equal(saved.fileChanges[0].operation, 'modified')
  assert.equal(saved.runs[0].details.events.at(-1).id, 8)
  assert.equal(saved.runs[0].details.events.at(-1).type, 'done')
  assert.equal(saved.runs[0].details.plan.status, 'done')
  assert.equal(saved.runs[0].details.candidateFiles, undefined)
})

test('stale plans and rejected reviews cannot overwrite current project files', async t => {
  const { storage } = await jsonFixture(t)
  const baseHash = fileFingerprint((await storage.getProjectData('p1')).files)
  await storage.startRun('p1', run('r1'), message('r1'))
  await storage.saveProjectFile('p1', file('manual edit'), at)
  await storage.claimRun('p1', 'r1', at)
  await storage.saveRunState('r1', 'review', { events: [], baseHash }, at)
  assert.equal(await storage.commitReviewedRun('p1', 'r1', baseHash, [file('generated')], at), 'stale')
  assert.equal(await storage.saveRunState('r1', 'rejected', { events: [] }, at, 'review'), true)
  assert.equal(await storage.commitReviewedRun('p1', 'r1', baseHash, [file('generated')], at), 'invalid')
  const data = await storage.getProjectData('p1')
  assert.equal(data.files[0].content, 'manual edit')
  assert.equal(data.runs[0].errorCode, 'RUN_REJECTED')
})

test('restart recovery interrupts running tasks once, preserving planned and review tasks', async t => {
  const { storage, path } = await jsonFixture(t)
  for (const [id, status] of [['r1', 'running'], ['r2', 'planned'], ['r3', 'review']]) {
    const record = run(id, status)
    record.details.events = [{ id: 2, type: 'planning' }]
    await storage.startRun('p1', record, message(id))
  }
  const resumed = createJsonStorage(path)
  await resumed.initialize()
  assert.equal(await resumed.interruptRuns(at), 1)
  assert.equal(await resumed.interruptRuns(at), 0)
  const { runs } = await resumed.getProjectData('p1')
  assert.deepEqual(runs.map(item => item.status), ['failed', 'planned', 'review'])
  assert.equal(runs[0].errorCode, 'RUN_INTERRUPTED')
  assert.equal(runs[0].details.events.at(-1).id, 3)
  assert.equal(runs[0].details.events.at(-1).devMode, true)
  assert.equal(runs[0].details.plan.prompt, 'Build a counter')
})

function mysqlFixture({ status = 'review', active = false, failOn = '' } = {}) {
  const calls = [], record = run('r1', status)
  record.details.events = [{ id: 3, type: 'review' }]
  record.details.candidateFiles = [file('new')]
  const row = { id: record.id, project_id: record.projectId, status, model: record.model, prompt_hash: 'prompt', created_at: at, updated_at: at, payload: JSON.stringify(record.details) }
  const execute = async (sql, params = []) => {
    calls.push({ sql, params })
    if (failOn && sql.includes(failOn)) throw new Error('injected transaction failure')
    if (sql.startsWith('SELECT id FROM projects') || sql.startsWith('SELECT * FROM projects')) return [[{ id: 'p1', owner_id: 'u1' }]]
    if (sql.startsWith('SELECT id FROM agent_runs')) return [active ? [{ id: 'other' }] : []]
    if (sql.startsWith('SELECT r.*') || sql.startsWith('SELECT * FROM agent_runs')) return [[row]]
    if (sql.startsWith('SELECT * FROM project_files')) return [[{ id: 'f1', project_id: 'p1', path: 'index.html', content: 'old', content_hash: 'old' }]]
    return [[]]
  }
  const connection = { execute, async beginTransaction() { calls.push({ sql: 'BEGIN' }) }, async commit() { calls.push({ sql: 'COMMIT' }) }, async rollback() { calls.push({ sql: 'ROLLBACK' }) }, release() { calls.push({ sql: 'RELEASE' }) } }
  return { calls, module: { createPool() { return { execute, query: execute, getConnection: async () => connection, end: async () => {} } } } }
}

test('MySQL initializes run-state migration after parent tables and reads stored plans', async () => {
  const fake = mysqlFixture(), storage = await createMysqlStorage('mysql://test', fake.module)
  await storage.initialize()
  const sql = fake.calls.map(call => call.sql)
  assert.ok(sql.findIndex(value => value.startsWith('CREATE TABLE IF NOT EXISTS agent_runs')) < sql.findIndex(value => value.startsWith('CREATE TABLE IF NOT EXISTS run_states')))
  assert.equal((await storage.getProjectData('p1')).runs[0].details.events[0].id, 3)
})

test('MySQL claims lock the project before checking active persisted runs', async () => {
  const fake = mysqlFixture({ status: 'planned', active: true }), storage = await createMysqlStorage('mysql://test', fake.module)
  assert.equal(await storage.claimRun('p1', 'r1', at), null)
  const sql = fake.calls.map(call => call.sql)
  assert.ok(sql.findIndex(value => value.startsWith('SELECT id FROM projects')) < sql.findIndex(value => value.startsWith('SELECT r.*')))
  assert.ok(sql.find(value => value.includes('id<>?') && value.endsWith('FOR UPDATE')))
  assert.ok(!sql.some(value => value.startsWith('UPDATE agent_runs')))
})

test('MySQL approval rolls back generated files when persisted final event fails', async () => {
  const fake = mysqlFixture({ failOn: 'INSERT INTO run_states' }), storage = await createMysqlStorage('mysql://test', fake.module)
  await assert.rejects(storage.commitReviewedRun('p1', 'r1', fileFingerprint([file()]), [file('new')], at))
  assert.ok(fake.calls.some(call => call.sql.startsWith('INSERT INTO file_changes')))
  assert.ok(fake.calls.some(call => call.sql === 'ROLLBACK'))
  assert.ok(!fake.calls.some(call => call.sql === 'COMMIT'))
})

test('MySQL rejects concurrent manual writes and compares review status under lock', async () => {
  const fake = mysqlFixture({ active: true, status: 'done' }), storage = await createMysqlStorage('mysql://test', fake.module)
  for (const mutation of [() => storage.saveProjectFile('p1', file(), at), () => storage.restoreProject('p1', [], at), () => storage.deleteProject('u1', 'p1', at)]) await assert.rejects(mutation(), { code: 'PROJECT_BUSY' })
  assert.equal(await storage.saveRunState('r1', 'rejected', {}, at, 'review'), false)
  assert.ok(!fake.calls.some(call => /^(INSERT|UPDATE|DELETE)/.test(call.sql)))
})
