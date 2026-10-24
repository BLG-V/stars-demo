import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitForHealth(base, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error('API process exited before becoming healthy')
    try {
      if ((await fetch(`${base}/api/health`)).ok) return
    } catch {
      // API is still starting.
    }
    await wait(25)
  }
  throw new Error('API did not become healthy in time')
}

function startApi(port, dataFile) {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      REQUIRE_EMAIL_VERIFICATION: 'false',
      ALLOW_STUB_MODEL: 'false',
      STARS_STORAGE: 'json',
      STARS_DATA_FILE: dataFile,
      PORT: String(port),
    },
  })
  let logs = ''
  child.stdout.on('data', chunk => { logs += chunk.toString() })
  child.stderr.on('data', chunk => { logs += chunk.toString() })
  return { child, getLogs: () => logs }
}

async function jsonRequest(base, path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const body = await response.json()
  return { response, body }
}

async function register(base, email) {
  const { response, body } = await jsonRequest(base, '/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'password123' }),
  })
  assert.equal(response.status, 201)
  return { user: body.user, cookie: response.headers.get('set-cookie').split(';')[0] }
}

async function login(base, email) {
  const { response, body } = await jsonRequest(base, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'password123' }),
  })
  assert.equal(response.status, 200)
  return { user: body.user, cookie: response.headers.get('set-cookie').split(';')[0] }
}

async function stopApi(child) {
  if (child.exitCode !== null) return
  child.kill()
  await new Promise(resolve => child.once('exit', resolve))
}

test('folders support authenticated CRUD, project assignment, isolation, and persistence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stars-folders-'))
  const dataFile = join(dir, 'stars.json')
  const port = 19600 + Math.floor(Math.random() * 100)
  let running = startApi(port, dataFile)
  const base = `http://127.0.0.1:${port}`

  try {
    await waitForHealth(base, running.child)

    const unauthenticated = await jsonRequest(base, '/api/folders')
    assert.equal(unauthenticated.response.status, 401)
    assert.equal(unauthenticated.body.error.code, 'UNAUTHENTICATED')

    const alice = await register(base, 'folders-alice@example.test')
    const created = await jsonRequest(base, '/api/folders', {
      method: 'POST', headers: { cookie: alice.cookie }, body: JSON.stringify({ name: '工作项目' }),
    })
    assert.equal(created.response.status, 201)
    assert.equal(created.body.folder.name, '工作项目')
    const folderId = created.body.folder.id

    const duplicate = await jsonRequest(base, '/api/folders', {
      method: 'POST', headers: { cookie: alice.cookie }, body: JSON.stringify({ name: '工作项目' }),
    })
    assert.equal(duplicate.response.status, 409)
    assert.equal(duplicate.body.error.code, 'DUPLICATE_FOLDER')

    const projectCreated = await jsonRequest(base, '/api/projects', {
      method: 'POST', headers: { cookie: alice.cookie }, body: JSON.stringify({ name: 'Stars landing', initialPrompt: 'Build a landing page' }),
    })
    assert.equal(projectCreated.response.status, 201)
    const projectId = projectCreated.body.project.id
    assert.equal(projectCreated.body.project.folderId, null)

    const assigned = await jsonRequest(base, `/api/projects/${projectId}`, {
      method: 'PATCH', headers: { cookie: alice.cookie }, body: JSON.stringify({ folderId }),
    })
    assert.equal(assigned.response.status, 200)
    assert.equal(assigned.body.project.folderId, folderId)

    const filtered = await jsonRequest(base, `/api/projects?folderId=${encodeURIComponent(folderId)}`, { headers: { cookie: alice.cookie } })
    assert.deepEqual(filtered.body.projects.map(project => project.id), [projectId])

    const renamed = await jsonRequest(base, `/api/folders/${folderId}`, {
      method: 'PATCH', headers: { cookie: alice.cookie }, body: JSON.stringify({ name: '重点项目' }),
    })
    assert.equal(renamed.response.status, 200)
    assert.equal(renamed.body.folder.name, '重点项目')

    const secondFolder = await jsonRequest(base, '/api/folders', {
      method: 'POST', headers: { cookie: alice.cookie }, body: JSON.stringify({ name: '其他项目' }),
    })
    assert.equal(secondFolder.response.status, 201)
    const duplicateRename = await jsonRequest(base, `/api/folders/${secondFolder.body.folder.id}`, {
      method: 'PATCH', headers: { cookie: alice.cookie }, body: JSON.stringify({ name: '重点项目' }),
    })
    assert.equal(duplicateRename.response.status, 409)

    // A restart must retain the folder and project assignment in JSON storage.
    await stopApi(running.child)
    running = startApi(port, dataFile)
    await waitForHealth(base, running.child)
    const aliceAfterRestart = await login(base, 'folders-alice@example.test')
    const persistedFolders = await jsonRequest(base, '/api/folders', { headers: { cookie: aliceAfterRestart.cookie } })
    assert.deepEqual(persistedFolders.body.folders.map(folder => folder.name).sort(), ['其他项目', '重点项目'])
    const persistedProjects = await jsonRequest(base, '/api/projects', { headers: { cookie: aliceAfterRestart.cookie } })
    assert.equal(persistedProjects.body.projects.find(project => project.id === projectId).folderId, folderId)

    const bob = await register(base, 'folders-bob@example.test')
    const bobFolders = await jsonRequest(base, '/api/folders', { headers: { cookie: bob.cookie } })
    assert.deepEqual(bobFolders.body.folders, [])
    const bobProject = await jsonRequest(base, '/api/projects', {
      method: 'POST', headers: { cookie: bob.cookie }, body: JSON.stringify({ name: 'Bob project' }),
    })
    assert.equal(bobProject.response.status, 201)
    const crossUserFolder = await jsonRequest(base, `/api/projects/${bobProject.body.project.id}`, {
      method: 'PATCH', headers: { cookie: bob.cookie }, body: JSON.stringify({ folderId }),
    })
    assert.equal(crossUserFolder.response.status, 404)
    const crossUserProject = await jsonRequest(base, `/api/projects/${projectId}`, { headers: { cookie: bob.cookie } })
    assert.equal(crossUserProject.response.status, 404)
    const crossUserReadFolder = await jsonRequest(base, `/api/folders/${folderId}`, { headers: { cookie: bob.cookie } })
    assert.equal(crossUserReadFolder.response.status, 404)

    const deleted = await jsonRequest(base, `/api/folders/${folderId}`, { method: 'DELETE', headers: { cookie: aliceAfterRestart.cookie } })
    assert.equal(deleted.response.status, 200)
    assert.equal(deleted.body.folder.id, folderId)
    const unassigned = await jsonRequest(base, `/api/projects/${projectId}`, { headers: { cookie: aliceAfterRestart.cookie } })
    assert.equal(unassigned.body.project.folderId, null)
    const deletedFilter = await jsonRequest(base, `/api/projects?folderId=${encodeURIComponent(folderId)}`, { headers: { cookie: aliceAfterRestart.cookie } })
    assert.deepEqual(deletedFilter.body.projects, [])
  } catch (error) {
    error.message += `\nAPI logs:\n${running.getLogs()}`
    throw error
  } finally {
    await stopApi(running.child)
  }
})
