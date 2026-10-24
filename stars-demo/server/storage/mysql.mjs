import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describeFileChanges, fileFingerprint } from './file-changes.mjs'

const iso = value => value instanceof Date ? value.toISOString() : value
const userRow = row => row && ({ id: row.id, email: row.email, passwordHash: row.password_hash, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) })
const sessionRow = row => row && ({ id: row.id, token: row.token, userId: row.user_id, expiresAt: iso(row.expires_at), createdAt: iso(row.created_at) })
const projectRow = row => row && ({ id: row.id, ownerId: row.owner_id, name: row.name, initialPrompt: row.initial_prompt, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), deletedAt: iso(row.deleted_at) })
const fileRow = row => ({ id: row.id, projectId: row.project_id, path: row.path, content: row.content, contentHash: row.content_hash, updatedByRunId: row.updated_by_run_id, updatedAt: iso(row.updated_at) })
const messageRow = row => ({ id: row.id, projectId: row.project_id, role: row.role, content: row.content, runId: row.run_id, createdAt: iso(row.created_at) })
const runRow = row => ({ id: row.id, projectId: row.project_id, status: row.status, model: row.model, promptHash: row.prompt_hash, errorCode: row.error_code, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.payload != null ? { details: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload } : {}) })
const snapshotRow = row => ({ id: row.id, projectId: row.project_id, name: row.name, manifest: typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest, createdBy: row.created_by, createdAt: iso(row.created_at) })

export async function createMysqlStorage(databaseUrl, mysqlModule) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required when STARS_STORAGE=mysql')
  const mysql = mysqlModule || await import('mysql2/promise')
  const pool = mysql.createPool(databaseUrl)
  async function transaction(work) {
    const connection = await pool.getConnection()
    try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result }
    catch (error) { await connection.rollback(); throw error }
    finally { connection.release() }
  }
  async function replaceFiles(connection, projectId, runId, files, at, previousRows) {
    const changes = describeFileChanges(previousRows.map(fileRow), files, runId)
    await connection.execute('DELETE FROM project_files WHERE project_id=?', [projectId])
    for (const file of files) await connection.execute('INSERT INTO project_files (id,project_id,path,content,content_hash,updated_by_run_id,updated_at) VALUES (?,?,?,?,?,?,?)', [file.id,file.projectId,file.path,file.content,file.contentHash,file.updatedByRunId,file.updatedAt])
    for (const change of changes) await connection.execute('INSERT INTO file_changes (id,run_id,path,operation,content_hash,diff_summary) VALUES (?,?,?,?,?,?)', [change.id,change.runId,change.path,change.operation,change.contentHash,change.diffSummary])
    await connection.execute('UPDATE agent_runs SET status=?,updated_at=? WHERE id=? AND project_id=?', ['done',at,runId,projectId])
    await connection.execute('UPDATE projects SET status=?,updated_at=? WHERE id=?', ['ready',at,projectId])
  }
  async function saveState(connection, runId, status, details, at) {
    const errorCode = status === 'failed' ? details.events?.findLast(event => event.type === 'error')?.errorCode || null : status === 'rejected' ? 'RUN_REJECTED' : null
    await connection.execute('UPDATE agent_runs SET status=?,error_code=?,updated_at=? WHERE id=?', [status,errorCode,at,runId])
    await connection.execute('INSERT INTO run_states (run_id,payload) VALUES (?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)', [runId,JSON.stringify(details)])
  }
  async function requireIdleProject(connection, projectId) {
    const [runs] = await connection.execute('SELECT id FROM agent_runs WHERE project_id=? AND status IN (?,?) FOR UPDATE', [projectId,'running','review'])
    if (runs.length) throw Object.assign(new Error('Project has an active run'), { code: 'PROJECT_BUSY' })
  }
  return {
    kind: 'mysql',
    async initialize() {
      if (process.env.STARS_SKIP_MIGRATIONS === 'true') return
      for (const file of ['001_initial.sql', '002_run_states.sql']) {
        const migration = await readFile(fileURLToPath(new URL('../migrations/' + file, import.meta.url)), 'utf8')
        for (const statement of migration.split(';').map(value => value.trim()).filter(Boolean)) await pool.query(statement)
      }
    },
    async close() { await pool.end() },
    async findUserByEmail(email) { const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]); return userRow(rows[0]) || null },
    async createUserAndSession(user, session) {
      return transaction(async connection => {
        try { await connection.execute('INSERT INTO users (id,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?)', [user.id,user.email,user.passwordHash,user.createdAt,user.updatedAt]) }
        catch (error) {
          if (error.code === 'ER_DUP_ENTRY') {
            const [rows] = await connection.execute('SELECT id FROM users WHERE email=? LIMIT 1 FOR UPDATE', [user.email])
            if (rows.length) return null
          }
          throw error
        }
        await connection.execute('INSERT INTO sessions (id,token,user_id,expires_at,created_at) VALUES (?,?,?,?,?)', [session.id,session.token,session.userId,session.expiresAt,session.createdAt])
        return user
      })
    },
    async findSession(token, at) {
      const [rows] = await pool.execute('SELECT s.*, u.id AS joined_user_id, u.email, u.password_hash, u.created_at AS user_created_at, u.updated_at AS user_updated_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>? LIMIT 1', [token,at])
      const row = rows[0]
      return row ? { session: sessionRow(row), user: { id: row.joined_user_id, email: row.email, passwordHash: row.password_hash, createdAt: iso(row.user_created_at), updatedAt: iso(row.user_updated_at) } } : null
    },
    async createSession(session) { await pool.execute('INSERT INTO sessions (id,token,user_id,expires_at,created_at) VALUES (?,?,?,?,?)', [session.id,session.token,session.userId,session.expiresAt,session.createdAt]); return session },
    async deleteSession(token) { await pool.execute('DELETE FROM sessions WHERE token=?', [token]) },
    async listProjects(userId) { const [rows] = await pool.execute('SELECT * FROM projects WHERE owner_id=? AND deleted_at IS NULL ORDER BY updated_at DESC', [userId]); return rows.map(projectRow) },
    async createProject(project) {
      await pool.execute('INSERT INTO projects (id,owner_id,name,initial_prompt,status,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?)', [project.id,project.ownerId,project.name,project.initialPrompt,project.status,project.createdAt,project.updatedAt,project.deletedAt])
      return project
    },
    async updateProject(userId, projectId, name, at) {
      const [result] = await pool.execute('UPDATE projects SET name=?,updated_at=? WHERE id=? AND owner_id=? AND deleted_at IS NULL', [name,at,projectId,userId])
      if (!result.affectedRows) return null
      const [rows] = await pool.execute('SELECT * FROM projects WHERE id=? AND owner_id=? AND deleted_at IS NULL LIMIT 1', [projectId,userId])
      return projectRow(rows[0]) || null
    },
    async deleteProject(userId, projectId, at) {
      return transaction(async connection => {
        const [projects] = await connection.execute('SELECT * FROM projects WHERE id=? AND owner_id=? AND deleted_at IS NULL FOR UPDATE', [projectId,userId])
        if (!projects.length) return null
        await requireIdleProject(connection, projectId)
        await connection.execute('UPDATE projects SET deleted_at=?,updated_at=? WHERE id=? AND owner_id=? AND deleted_at IS NULL', [at,at,projectId,userId])
        return { ...projectRow(projects[0]), deletedAt: at, updatedAt: at }
      })
    },
    async getOwnedProject(userId, projectId) { const [rows] = await pool.execute('SELECT * FROM projects WHERE id=? AND owner_id=? AND deleted_at IS NULL LIMIT 1', [projectId,userId]); return projectRow(rows[0]) || null },
    async getProjectData(projectId) {
      const [[files],[messages],[runs],[snapshots]] = await Promise.all([
        pool.execute('SELECT * FROM project_files WHERE project_id=? ORDER BY path', [projectId]),
        pool.execute('SELECT * FROM messages WHERE project_id=? ORDER BY created_at', [projectId]),
        pool.execute('SELECT r.*, s.payload FROM agent_runs r LEFT JOIN run_states s ON s.run_id=r.id WHERE r.project_id=? ORDER BY r.created_at', [projectId]),
        pool.execute('SELECT * FROM snapshots WHERE project_id=? ORDER BY created_at', [projectId]),
      ])
      return { files: files.map(fileRow), messages: messages.map(messageRow), runs: runs.map(runRow), snapshots: snapshots.map(snapshotRow) }
    },
    async saveProjectFile(projectId, file, at) {
      return transaction(async connection => {
        await connection.execute('SELECT id FROM projects WHERE id=? FOR UPDATE', [projectId])
        await requireIdleProject(connection, projectId)
        await connection.execute('INSERT INTO project_files (id,project_id,path,content,content_hash,updated_by_run_id,updated_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE content=VALUES(content),content_hash=VALUES(content_hash),updated_by_run_id=NULL,updated_at=VALUES(updated_at)', [file.id,file.projectId,file.path,file.content,file.contentHash,null,at])
        await connection.execute('UPDATE projects SET updated_at=? WHERE id=?', [at,projectId])
        return { ...file, projectId, updatedAt: at, updatedByRunId: null }
      })
    },
    async createSnapshot(snapshot) {
      return transaction(async connection => {
        await connection.execute('SELECT id FROM projects WHERE id=? FOR UPDATE', [snapshot.projectId])
        const [files] = await connection.execute('SELECT * FROM project_files WHERE project_id=? ORDER BY path FOR UPDATE', [snapshot.projectId])
        const result = { ...snapshot, manifest: files.slice(0, 50).map(row => { const file = fileRow(row); return { path: file.path, content: file.content, contentHash: file.contentHash } }) }
        await connection.execute('INSERT INTO snapshots (id,project_id,name,manifest,created_by,created_at) VALUES (?,?,?,?,?,?)', [result.id,result.projectId,result.name,JSON.stringify(result.manifest),result.createdBy,result.createdAt])
        return result
      })
    },
    async getSnapshot(projectId, snapshotId) { const [rows] = await pool.execute('SELECT * FROM snapshots WHERE project_id=? AND id=? LIMIT 1', [projectId,snapshotId]); return rows[0] ? snapshotRow(rows[0]) : null },
    async restoreProject(projectId, restoredFiles, at) {
      return transaction(async connection => {
        await connection.execute('SELECT id FROM projects WHERE id=? FOR UPDATE', [projectId])
        await requireIdleProject(connection, projectId)
        await connection.execute('DELETE FROM project_files WHERE project_id=?', [projectId])
        for (const file of restoredFiles) await connection.execute('INSERT INTO project_files (id,project_id,path,content,content_hash,updated_by_run_id,updated_at) VALUES (?,?,?,?,?,?,?)', [file.id,file.projectId,file.path,file.content,file.contentHash,file.updatedByRunId,file.updatedAt])
        await connection.execute('UPDATE projects SET status=?,updated_at=? WHERE id=?', ['ready',at,projectId])
        const [rows] = await connection.execute('SELECT * FROM projects WHERE id=? LIMIT 1', [projectId])
        return projectRow(rows[0])
      })
    },
    async startRun(projectId, run, message) {
      return transaction(async connection => {
        await connection.execute('INSERT INTO agent_runs (id,project_id,status,model,prompt_hash,error_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', [run.id,run.projectId,run.status,run.model,run.promptHash,run.errorCode,run.createdAt,run.updatedAt])
        if (run.details) await connection.execute('INSERT INTO run_states (run_id,payload) VALUES (?,?)', [run.id,JSON.stringify(run.details)])
        await connection.execute('INSERT INTO messages (id,project_id,role,content,run_id,created_at) VALUES (?,?,?,?,?,?)', [message.id,message.projectId,message.role,message.content,message.runId,message.createdAt])
      })
    },
    async claimRun(projectId, runId, at) {
      return transaction(async connection => {
        const [projects] = await connection.execute('SELECT id FROM projects WHERE id=? AND deleted_at IS NULL FOR UPDATE', [projectId])
        if (!projects.length) return null
        const [rows] = await connection.execute('SELECT r.*, s.payload FROM agent_runs r LEFT JOIN run_states s ON s.run_id=r.id WHERE r.id=? AND r.project_id=? FOR UPDATE', [runId,projectId])
        const run = rows[0] && runRow(rows[0])
        if (!run || run.status !== 'planned') return null
        const [active] = await connection.execute('SELECT id FROM agent_runs WHERE project_id=? AND id<>? AND status IN (?,?) FOR UPDATE', [projectId,runId,'running','review'])
        if (active.length) return null
        await connection.execute('UPDATE agent_runs SET status=?,updated_at=? WHERE id=?', ['running',at,runId])
        return { ...run, status: 'running', updatedAt: at }
      })
    },
    async saveRunState(runId, status, details, at, expectedStatus) {
      return transaction(async connection => {
        const [rows] = await connection.execute('SELECT * FROM agent_runs WHERE id=? FOR UPDATE', [runId])
        if (!rows.length || (expectedStatus && rows[0].status !== expectedStatus)) return false
        await saveState(connection, runId, status, details, at)
        return true
      })
    },
    async commitReviewedRun(projectId, runId, baseHash, files, at) {
      return transaction(async connection => {
        const [projects] = await connection.execute('SELECT id FROM projects WHERE id=? AND deleted_at IS NULL FOR UPDATE', [projectId])
        if (!projects.length) return 'invalid'
        const [rows] = await connection.execute('SELECT r.*, s.payload FROM agent_runs r LEFT JOIN run_states s ON s.run_id=r.id WHERE r.id=? AND r.project_id=? FOR UPDATE', [runId,projectId])
        if (rows[0]?.status === 'done') return 'done'
        if (rows[0]?.status !== 'review') return 'invalid'
        const [previousRows] = await connection.execute('SELECT * FROM project_files WHERE project_id=? ORDER BY path FOR UPDATE', [projectId])
        if (fileFingerprint(previousRows.map(fileRow)) !== baseHash) return 'stale'
        await replaceFiles(connection, projectId, runId, files, at, previousRows)
        const run = runRow(rows[0]), details = run.details || {}
        details.events ||= []
        details.events.push({ id: Math.max(0, ...details.events.map(event => Number(event.id) || 0)) + 1, type: 'done', runId, summary: '变更已确认并保存', createdAt: at, devMode: run.model === 'local-stub' })
        if (details.plan) details.plan.status = 'done'
        delete details.candidateFiles
        await connection.execute('INSERT INTO run_states (run_id,payload) VALUES (?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)', [runId,JSON.stringify(details)])
        return 'done'
      })
    },
    async interruptRuns(at) {
      return transaction(async connection => {
        const [rows] = await connection.execute('SELECT r.*, s.payload FROM agent_runs r LEFT JOIN run_states s ON s.run_id=r.id WHERE r.status=? FOR UPDATE', ['running'])
        for (const row of rows) {
          const run = runRow(row), details = run.details || {}
          details.events ||= []
          details.events.push({ id: Math.max(0, ...details.events.map(event => Number(event.id) || 0)) + 1, type: 'error', runId: run.id, summary: '服务重启，运行已中断；请创建新计划重试。', errorCode: 'RUN_INTERRUPTED', createdAt: at, devMode: run.model === 'local-stub' })
          await saveState(connection, run.id, 'failed', details, at)
        }
        return rows.length
      })
    },
    async completeRun(projectId, runId, files, at) {
      return transaction(async connection => {
        await connection.execute('SELECT id FROM projects WHERE id=? FOR UPDATE', [projectId])
        const [previousRows] = await connection.execute('SELECT * FROM project_files WHERE project_id=? ORDER BY path FOR UPDATE', [projectId])
        await replaceFiles(connection, projectId, runId, files, at, previousRows)
      })
    },
    async failRun(runId, errorCode, at) { await pool.execute('UPDATE agent_runs SET status=?,error_code=?,updated_at=? WHERE id=?', ['failed',errorCode,at,runId]) },
  }
}
