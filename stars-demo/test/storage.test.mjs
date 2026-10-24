import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMysqlStorage } from '../server/storage/mysql.mjs'
import { createJsonStorage } from '../server/storage/json.mjs'

function fakeMysql({ failOn = '', duplicateEmail = false, previousFiles = [{ id: 'f1', project_id: 'p1', path: 'index.html', content: '<h1>saved</h1>', content_hash: 'hash', updated_by_run_id: 'r1', updated_at: '2026-01-01T00:00:00.000Z' }] } = {}) {
  const calls = []
  let released = false
  const execute = async (sql, params = []) => {
    calls.push({ sql, params })
    if (failOn && sql.includes(failOn)) throw new Error('injected failure')
    if (duplicateEmail && sql.startsWith('INSERT INTO users')) throw Object.assign(new Error('private SQL details'), { code: 'ER_DUP_ENTRY' })
    if (duplicateEmail && sql.startsWith('SELECT id FROM users WHERE email=')) return [[{ id: 'existing-user' }]]
    if (sql.startsWith('SELECT * FROM project_files')) return [previousFiles]
    if (sql.startsWith('SELECT * FROM projects')) return [[{ id: 'p1', owner_id: 'u1', name: 'Owned', initial_prompt: '', status: 'ready', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null }]]
    return [[]]
  }
  const connection = {
    execute,
    async beginTransaction() { calls.push({ sql: 'BEGIN' }) },
    async commit() { calls.push({ sql: 'COMMIT' }) },
    async rollback() { calls.push({ sql: 'ROLLBACK' }) },
    release() { released = true },
  }
  return {
    calls,
    isReleased: () => released,
    module: { createPool(url) { assert.equal(url, 'mysql://local-test'); return { execute, getConnection: async () => connection, end: async () => {} } } },
  }
}

test('MySQL storage parameterizes ownership queries and commits generation writes atomically', async () => {
  const fake = fakeMysql()
  const storage = await createMysqlStorage('mysql://local-test', fake.module)
  const project = await storage.getOwnedProject('user-from-session', 'project-id')
  assert.equal(project.ownerId, 'u1')
  const ownershipQuery = fake.calls.find(call => call.sql.includes('owner_id=?'))
  assert.deepEqual(ownershipQuery.params, ['project-id', 'user-from-session'])

  const existing = [
    { id: 'f1', project_id: 'p1', path: 'index.html', content: '<h1>saved</h1>', content_hash: 'old-index-hash', updated_by_run_id: 'r0', updated_at: '2026-01-01T00:00:00.000Z' },
    { id: 'f2', project_id: 'p1', path: 'style.css', content: 'body{}', content_hash: 'old-style-hash', updated_by_run_id: 'r0', updated_at: '2026-01-01T00:00:00.000Z' },
  ]
  const changeFake = fakeMysql({ previousFiles: existing })
  const changeStorage = await createMysqlStorage('mysql://local-test', changeFake.module)
  await changeStorage.completeRun('p1', 'r1', [
    { id: 'f3', projectId: 'p1', path: 'index.html', content: '<main/>', contentHash: 'h2', updatedByRunId: 'r1', updatedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'f4', projectId: 'p1', path: 'app.js', content: 'start()', contentHash: 'h3', updatedByRunId: 'r1', updatedAt: '2026-01-02T00:00:00.000Z' },
  ], '2026-01-02T00:00:00.000Z')
  const sql = changeFake.calls.map(call => call.sql)
  assert.ok(sql.indexOf('BEGIN') < sql.findIndex(value => value.startsWith('DELETE FROM project_files')))
  assert.ok(sql.includes('COMMIT'))
  assert.equal(sql.filter(value => value.startsWith('UPDATE agent_runs')).length, 1)
  assert.equal(sql.filter(value => value.startsWith('UPDATE projects')).length, 1)
  const changes = changeFake.calls.filter(call => call.sql.startsWith('INSERT INTO file_changes'))
  assert.deepEqual(changes.map(call => [call.params[2], call.params[3], call.params[4]]), [
    ['index.html', 'modified', 'h2'],
    ['app.js', 'added', 'h3'],
    ['style.css', 'deleted', 'old-style-hash'],
  ])
  assert.match(changes[0].params[5], /Modified file/)
  assert.match(changes[1].params[5], /Added file/)
  assert.match(changes[2].params[5], /Deleted file/)
  assert.equal(changeFake.isReleased(), true)
  assert.ok(changeFake.calls.find(call => call.sql.startsWith('INSERT INTO project_files')).params.includes('<main/>'), 'file content is passed as a SQL parameter')
})

test('registration stores user and session in one transaction', async () => {
  const fake = fakeMysql()
  const storage = await createMysqlStorage('mysql://local-test', fake.module)
  await storage.createUserAndSession(
    { id: 'u1', email: 'user@example.test', passwordHash: 'hash', createdAt: 'now', updatedAt: 'now' },
    { id: 's1', token: 'token', userId: 'u1', expiresAt: 'later', createdAt: 'now' },
  )
  assert.deepEqual(fake.calls.map(call => call.sql), [
    'BEGIN',
    'INSERT INTO users (id,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?)',
    'INSERT INTO sessions (id,token,user_id,expires_at,created_at) VALUES (?,?,?,?,?)',
    'COMMIT',
  ])
})

test('MySQL maps a confirmed email unique race to a duplicate result without leaking SQL details', async () => {
  const fake = fakeMysql({ duplicateEmail: true })
  const storage = await createMysqlStorage('mysql://local-test', fake.module)
  const result = await storage.createUserAndSession(
    { id: 'u1', email: 'same@example.test', passwordHash: 'hash', createdAt: 'now', updatedAt: 'now' },
    { id: 's1', token: 'token', userId: 'u1', expiresAt: 'later', createdAt: 'now' },
  )
  assert.equal(result, null)
  const duplicateLookup = fake.calls.find(call => call.sql.startsWith('SELECT id FROM users WHERE email='))
  assert.deepEqual(duplicateLookup.params, ['same@example.test'])
  assert.ok(!fake.calls.some(call => call.sql.startsWith('INSERT INTO sessions')))
  assert.ok(fake.calls.some(call => call.sql === 'COMMIT'))
  assert.ok(!JSON.stringify(fake.calls).includes('private SQL details'))
})

test('MySQL storage rolls back generated files when change audit insertion fails', async () => {
  const fake = fakeMysql({ failOn: 'INSERT INTO file_changes' })
  const storage = await createMysqlStorage('mysql://local-test', fake.module)
  await assert.rejects(storage.completeRun('p1', 'r1', [{ id: 'f2', projectId: 'p1', path: 'index.html', content: 'x', contentHash: 'h2', updatedByRunId: 'r1', updatedAt: 'now' }], 'now'))
  const sql = fake.calls.map(call => call.sql)
  assert.ok(sql.includes('BEGIN'))
  assert.ok(sql.includes('ROLLBACK'))
  assert.ok(sql.some(value => value.startsWith('INSERT INTO project_files')))
  assert.ok(!sql.includes('COMMIT'))
  assert.equal(fake.isReleased(), true)
})

test('JSON completeRun persists added, modified and deleted file changes atomically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stars-json-storage-'))
  const path = join(dir, 'stars.json')
  await writeFile(path, JSON.stringify({
    projects: [{ id: 'p1', status: 'generating', updatedAt: 'old' }],
    files: [
      { id: 'old-index', projectId: 'p1', path: 'index.html', content: '<h1>old</h1>', contentHash: 'old-hash' },
      { id: 'old-css', projectId: 'p1', path: 'style.css', content: 'body{}', contentHash: 'css-hash' },
    ],
    runs: [{ id: 'r1', projectId: 'p1', status: 'running', updatedAt: 'old' }],
  }))
  const storage = createJsonStorage(path)
  await storage.initialize()
  await storage.completeRun('p1', 'r1', [
    { id: 'new-index', projectId: 'p1', path: 'index.html', content: '<main/>', contentHash: 'new-hash', updatedByRunId: 'r1', updatedAt: 'now' },
    { id: 'new-js', projectId: 'p1', path: 'app.js', content: 'start()', contentHash: 'js-hash', updatedByRunId: 'r1', updatedAt: 'now' },
  ], 'now')
  const saved = JSON.parse(await readFile(path, 'utf8'))
  assert.deepEqual(saved.fileChanges.map(({ path, operation, contentHash, diffSummary }) => [path, operation, contentHash, diffSummary]), [
    ['index.html', 'modified', 'new-hash', 'Modified file (1 → 1 lines)'],
    ['app.js', 'added', 'js-hash', 'Added file (1 lines)'],
    ['style.css', 'deleted', 'css-hash', 'Deleted file (1 lines)'],
  ])
  assert.equal(saved.runs[0].status, 'done')
  assert.equal(saved.projects[0].status, 'ready')
})

test('snapshot contents are captured transactionally from persisted project files', async () => {
  const fake = fakeMysql()
  const storage = await createMysqlStorage('mysql://local-test', fake.module)
  const snapshot = await storage.createSnapshot({ id: 's1', projectId: 'p1', name: 'v1', createdBy: 'u1', createdAt: '2026-01-02T00:00:00.000Z' })
  assert.deepEqual(snapshot.manifest, [{ path: 'index.html', content: '<h1>saved</h1>', contentHash: 'hash' }])
  const sql = fake.calls.map(call => call.sql)
  assert.ok(sql.includes('BEGIN'))
  assert.ok(sql.includes('COMMIT'))
  assert.ok(fake.calls.some(call => call.sql.startsWith('INSERT INTO snapshots')))
})
