import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { approveRun, createProject, createSnapshot, deleteProject, getProject, getSession, listProjects, login, logout, planProject, register, rejectRun, restoreSnapshot, runProject, saveProjectFile, updateProject } from './api'

const agents = [
  ['M', 'Mike', 'Team Leader', '#e39b69'],
  ['P', 'Priya', 'Product', '#9b84f6'],
  ['A', 'Aria', 'Architect', '#66c4bd'],
  ['E', 'Alex', 'Engineer', '#f0b45c'],
  ['R', 'Rui', 'Research', '#ee7f98'],
  ['S', 'Sora', 'SEO', '#7aacef'],
  ['D', 'Dylan', 'Data', '#9b9da8'],
  ['Q', 'Quinn', 'QA', '#b3da7d'],
]

function Modal({ children, titleId, onClose, className = '' }) {
  const ref = useRef(null)
  useEffect(() => { ref.current.showModal() }, [])
  return <dialog ref={ref} className={`auth-modal ${className}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }}>{children}</dialog>
}

function FileDiff({ changes, beforeLabel = '当前文件', afterLabel = '待写入文件' }) {
  return <div className="file-diffs">{changes.length ? changes.map(change => {
    const before = (change.before || '').split('\n')
    const after = (change.after || '').split('\n')
    return <details key={change.path} open><summary>{change.path} · {({ delete: '删除', deleted: '删除', create: '新增', added: '新增', update: '修改', modified: '修改' })[change.operation] || '修改'}</summary><div className="diff-columns">{[[beforeLabel, before, after, 'removed'], [afterLabel, after, before, 'added']].map(([label, lines, other, kind]) => <div key={label}><strong>{label}</strong><pre>{lines.map((line, index) => <span className={line !== other[index] ? `diff-line ${kind}` : 'diff-line'} key={index}><span className="line-number">{index + 1}</span>{line || ' '}</span>)}</pre></div>)}</div></details>
  }) : <p className="empty-note">文件内容一致，没有差异。</p>}</div>
}

function compareFiles(before, after) {
  const previous = new Map(before.map(file => [file.path, file.content]))
  const next = new Map(after.map(file => [file.path, file.content]))
  return [...new Set([...previous.keys(), ...next.keys()])].filter(path => previous.get(path) !== next.get(path)).map(path => ({ path, before: previous.get(path) || '', after: next.get(path) || '', operation: !previous.has(path) ? 'create' : !next.has(path) ? 'delete' : 'update' }))
}

function Icon({ name }) {
  const paths = {
    home: 'M3 10.5 12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-5v-6h-5v6h-5A1.5 1.5 0 0 1 3 19.5z',
    resources: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM8 8h8M8 12h8M8 16h5',
    projects: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM8 8h8v8H8z',
    recent: 'M12 6v6l4 2M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5',
    plus: 'M12 5v14M5 12h14',
    sparkle: 'm12 2 1.5 6.5L20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5z',
    chevron: 'm7 10 5 5 5-5',
    mic: 'M12 15a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3ZM5 12a7 7 0 0 0 14 0M12 19v3M8 22h8',
    send: 'm4 4 16 8-16 8 3-8zM7 12h10',
    desktop: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9A1.5 1.5 0 0 1 18.5 16h-13A1.5 1.5 0 0 1 4 14.5zM9 20h6M12 16v4',
    mobile: 'M8 3.5A1.5 1.5 0 0 1 9.5 2h5A1.5 1.5 0 0 1 16 3.5v17a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 20.5zM11 19h2',
    refresh: 'M20 11a8 8 0 0 0-14-4L4 9m0-4v4h4M4 13a8 8 0 0 0 14 4l2-2m0 4v-4h-4',
    check: 'm5 12 4 4L19 6',
    template: 'M6 3h9l3 3v15H6zM15 3v4h4M9 12h6M9 16h6',
    arrow: 'M5 12h13m-5-5 5 5-5 5',
  }
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

function App() {
  const [activeTab, setActiveTab] = useState('发现')
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState('构建')
  const [running, setRunning] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [step, setStep] = useState(0)
  const [selectedFile, setSelectedFile] = useState('index.html')
  const [editingFile, setEditingFile] = useState(false)
  const [fileDraft, setFileDraft] = useState('')
  const [savingFile, setSavingFile] = useState(false)
  const [files, setFiles] = useState([])
  const [mobilePreview, setMobilePreview] = useState(false)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [user, setUser] = useState(null)
  const [projects, setProjects] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [currentProject, setCurrentProject] = useState(null)
  const [snapshotToRestore, setSnapshotToRestore] = useState(null)
  const [authModal, setAuthModal] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [apiStatus, setApiStatus] = useState('checking')
  const [apiError, setApiError] = useState('')
  const [runSource, setRunSource] = useState('backend')
  const [serverPreview, setServerPreview] = useState(false)
  const [previewRevision, setPreviewRevision] = useState(0)
  const [plan, setPlan] = useState(null)
  const [review, setReview] = useState(null)
  const [messages, setMessages] = useState([])
  const [runs, setRuns] = useState([])
  const [liveEvents, setLiveEvents] = useState([])
  const [projectDialog, setProjectDialog] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [dialogError, setDialogError] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [snapshotDiff, setSnapshotDiff] = useState(null)
  const [previewErrors, setPreviewErrors] = useState([])
  const previewRef = useRef(null)
  const activeRunRef = useRef(null)
  const previewToken = useMemo(() => crypto.randomUUID(), [files, previewRevision])
  const runComplete = completed && !running && !review && !plan && !apiError

  const timeline = [
    ['planning', '规划需求', '拆解页面、交互与文件结构'],
    ['generating', '生成代码', '根据确认计划生成候选文件'],
    ['validating', '静态校验', '检查文件路径、大小和受限内容'],
    ['done', runSource === 'stub' ? '开发模式构建完成' : '构建完成', runSource === 'stub' ? '当前使用本地 Stub，没有调用真实模型' : '确认差异后保存并显示预览'],
  ]

  useEffect(() => () => {
    activeRunRef.current?.controller.abort()
    activeRunRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([getSession(), listProjects()]).then(([sessionResult, projectsResult]) => {
      if (cancelled) return
      if (sessionResult.status === 'fulfilled') setUser(sessionResult.value?.user || sessionResult.value)
      if (projectsResult.status === 'fulfilled') setProjects(projectsResult.value?.projects || projectsResult.value || [])
      const hasServerResponse = sessionResult.status === 'fulfilled' || projectsResult.status === 'fulfilled' || (sessionResult.reason?.status === 401)
      setApiStatus(hasServerResponse ? 'online' : 'offline')
      const projectId = new URLSearchParams(window.location.search).get('projectId')
      if (projectId && sessionResult.status === 'fulfilled') {
        getProject(projectId).then(projectData => { if (!cancelled) applyProjectData(projectData) }).catch(error => { if (!cancelled) setApiError(error.message || '无法恢复项目') })
      }
    })
    return () => { cancelled = true }
  }, [])

  const selectedContent = useMemo(() => files.find(([name]) => name === selectedFile)?.[1] ?? '', [files, selectedFile])

  useEffect(() => {
    setPreviewErrors([])
    const receive = event => {
      if (event.source !== previewRef.current?.contentWindow || event.data?.token !== previewToken || event.data?.type !== 'stars-preview-error') return
      setPreviewErrors(items => [...items, String(event.data.message).slice(0, 500)].slice(-20))
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [previewToken])

  const previewSrcDoc = useMemo(() => {
    if (!serverPreview) return ''
    const html = files.find(([name]) => name === 'index.html')?.[1] || '<main><h1>Stars</h1></main>'
    const css = files.filter(([name]) => name === 'style.css' || name === 'styles.css').map(([, content]) => content).join('\n')
    const js = files.find(([name]) => name === 'script.js')?.[1] || files.find(([name]) => name === 'app.js')?.[1] || ''
    const safeCss = css.replace(/<\/style/gi, '<\\/style')
    const safeJs = js.replace(/<\/script/gi, '<\\/script')
    const monitor = `(()=>{const report=message=>parent.postMessage({type:'stars-preview-error',token:${JSON.stringify(previewToken)},message:String(message)},'*');addEventListener('error',event=>report(event.message));addEventListener('unhandledrejection',event=>report(event.reason?.message||event.reason));const original=console.error;console.error=(...args)=>{report(args.join(' '));original.apply(console,args)};})();`
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:;"><script>${monitor}</script><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}body{padding:28px;background:#fbfbfb;color:#141418}${safeCss}</style></head><body>${html}<script>${safeJs}</script></body></html>`
  }, [files, serverPreview, previewToken])

  function applyProjectData(data) {
    const project = data?.project || data
    if (project) setCurrentProject(project)
    setPlan(null)
    setReview(null)
    setEditingFile(false)
    if (Array.isArray(data?.messages)) setMessages(data.messages)
    const activeRun = data?.runs?.find(run => run.status === 'running')
    setRunning(!!activeRun)
    if (Array.isArray(data?.runs)) {
      setRuns(data.runs)
      const pending = [...data.runs].reverse().find(run => run.status === 'review')
      if (pending) setReview({ runId: pending.id, changes: pending.details?.changes || [] })
      if (activeRun) watchRun(project.id, activeRun.id, activeRun.details?.events || [])
    }
    if (Array.isArray(data?.snapshots)) setSnapshots([...data.snapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    if (Array.isArray(data?.runs) && data.runs.length) {
      const latestRun = [...data.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      setRunSource(latestRun.model === 'local-stub' ? 'stub' : 'backend')
    }
    if (Array.isArray(data?.files)) {
      const nextFiles = data.files.map((file) => [file.path, file.content])
      if (nextFiles.length) {
        setServerPreview(true)
        setFiles(nextFiles)
        setSelectedFile((current) => nextFiles.some(([name]) => name === current) ? current : nextFiles[0][0])
        setCompleted(true)
        if (project?.status === 'ready' && !activeRun) setStep(3)
      } else {
        setServerPreview(false)
        setFiles([])
        setCompleted(false)
      }
    }
  }

  async function submitPrompt(event) {
    event.preventDefault()
    if (!prompt.trim() || running) return
    setApiError('')
    if (!user) {
      setAuthMode('login')
      setAuthModal(true)
      setAuthError('登录后才能创建并保存项目。')
      return
    }
    if (apiStatus !== 'online') {
      setApiError('Stars 服务当前不可用，请稍后重试。')
      return
    }
    if (plan || review) return
    setRunning(true)
    setStep(0)
    try {
      const project = currentProject || await createProject(`Stars ${new Date().toLocaleDateString('zh-CN')}`, prompt.trim())
      const projectData = project?.project || project
      setCurrentProject(projectData)
      window.history.replaceState({}, '', `/?projectId=${encodeURIComponent(projectData.id)}`)
      setProjects((items) => [projectData, ...items.filter((item) => item.id !== projectData.id)])
      const result = await planProject(projectData.id, prompt.trim())
      setPlan(result.plan)
    } catch (error) {
      setApiError(error.message || '规划服务暂不可用，请重试')
      if (error.status === 401) setApiStatus('auth-required')
    } finally { setRunning(false) }
  }

  async function confirmPlan() {
    if (!plan || !currentProject || running) return
    const approvedPlan = plan
    setPlan(null)
    await watchRun(currentProject.id, approvedPlan.id)
  }

  async function watchRun(projectId, planId, savedEvents = []) {
    if (activeRunRef.current?.planId === planId) return
    activeRunRef.current?.controller.abort()
    const subscription = { planId, controller: new AbortController() }
    activeRunRef.current = subscription
    setRunning(true)
    setLiveEvents(savedEvents)
    setApiError('')
    try {
      let failure = ''
      const showEvent = event => {
        if (activeRunRef.current !== subscription || subscription.controller.signal.aborted) return
        setLiveEvents(items => [...items, event])
        if (event.devMode) setRunSource('stub')
        setStep({ queued: 0, planning: 0, read_file: 0, generating: 1, validating: 2, file_change: 2, review: 2, done: 3, error: 2 }[event.type] ?? 0)
        if (event.type === 'review') setReview({ runId: event.runId, changes: event.changes || [] })
        if (event.type === 'error') failure = event.summary || '生成失败，请重试'
      }
      const lastEvent = savedEvents.at(-1)
      if (lastEvent) setStep({ generating: 1, validating: 2, file_change: 2 }[lastEvent.type] ?? 0)
      await runProject(projectId, planId, showEvent, { lastEventId: lastEvent?.id, signal: subscription.controller.signal })
      const refreshed = await getProject(projectId)
      if (activeRunRef.current !== subscription || subscription.controller.signal.aborted) return
      applyProjectData(refreshed)
      if (failure) setApiError(failure)
    } catch (error) {
      if (activeRunRef.current === subscription && !subscription.controller.signal.aborted) setApiError(error.message || '连接中断，任务可能仍在后台运行，请重新连接查看状态。')
    } finally {
      if (activeRunRef.current === subscription) activeRunRef.current = null
    }
  }

  async function decideReview(approved) {
    if (!review || !currentProject || busy) return
    setBusy(true)
    try {
      const result = await (approved ? approveRun : rejectRun)(currentProject.id, review.runId)
      applyProjectData(result)
      setReview(null)
      setApiError('')
      setFeedback(approved ? '文件变更已保存，预览已更新。' : '已放弃本次生成，原文件保持不变。')
      if (approved) setStep(3)
    } catch (error) { setApiError(error.message || '处理文件变更失败') }
    finally { setBusy(false) }
  }

  async function submitAuth(event) {
    event.preventDefault()
    setAuthError('')
    try {
      const result = authMode === 'login' ? await login(authEmail, authPassword) : await register(authEmail, authPassword)
      setUser(result?.user || result)
      const projectList = await listProjects()
      setProjects(projectList?.projects || projectList || [])
      const projectId = new URLSearchParams(window.location.search).get('projectId')
      if (projectId) applyProjectData(await getProject(projectId))
      setAuthModal(false)
      setAuthPassword('')
      setAuthError('')
      setApiStatus('online')
    } catch (error) {
      setAuthError(error.message || '认证失败，请检查输入')
    }
  }

  async function handleLogout() {
    try { await logout() } catch { /* A local session can still be cleared if the API is unavailable. */ }
    setUser(null)
    setCurrentProject(null)
    setSnapshots([])
    setProjects([])
    setFiles([])
    setMessages([])
    setRuns([])
    setPlan(null)
    setReview(null)
    setCompleted(false)
    setServerPreview(false)
    window.history.replaceState({}, '', '/')
  }

  async function openProject(projectId) {
    try {
      const result = await getProject(projectId)
      applyProjectData(result)
      setActiveTab('我的项目')
      window.history.replaceState({}, '', `/?projectId=${encodeURIComponent(projectId)}`)
      setApiError('')
    } catch (error) { setApiError(error.message || '无法打开项目') }
  }

  async function submitProjectDialog(event) {
    event.preventDefault()
    if (!projectDialog || busy) return
    setBusy(true)
    setDialogError('')
    const { project, action } = projectDialog
    try {
      if (action === 'rename') {
        const name = projectName.trim()
        if (!name) { setDialogError('请输入项目名称。'); return }
        const { project: updated } = await updateProject(project.id, name)
        setProjects(items => items.map(item => item.id === updated.id ? updated : item))
        if (currentProject?.id === updated.id) setCurrentProject(updated)
        setFeedback('项目已重命名。')
      } else {
        await deleteProject(project.id)
        setProjects(items => items.filter(item => item.id !== project.id))
        if (currentProject?.id === project.id) {
          setCurrentProject(null)
          setFiles([])
          setSnapshots([])
          setMessages([])
          setRuns([])
          setPlan(null)
          setReview(null)
          setCompleted(false)
          setServerPreview(false)
          window.history.replaceState({}, '', '/')
        }
        setFeedback('项目已删除。')
      }
      setProjectDialog(null)
      setApiError('')
    } catch (error) { setDialogError(error.message || '项目操作失败，请重试。') }
    finally { setBusy(false) }
  }

  function editProject(project, action) {
    setProjectDialog({ project, action })
    setProjectName(project.name)
    setDialogError('')
  }

  async function saveSelectedFile() {
    if (!currentProject || !editingFile || savingFile) return
    setSavingFile(true)
    try {
      const result = await saveProjectFile(currentProject.id, selectedFile, fileDraft)
      setFiles(items => items.map(([name, content]) => name === selectedFile ? [name, result.file.content] : [name, content]))
      setEditingFile(false)
      setFeedback('文件已保存。')
      setApiError('')
    } catch (error) { setApiError(error.message || '保存文件失败') }
    finally { setSavingFile(false) }
  }

  async function saveSnapshot() {
    if (!currentProject || !serverPreview) return
    try {
      const result = await createSnapshot(currentProject.id, `版本 ${snapshots.length + 1}`)
      setSnapshots((items) => [result.snapshot, ...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      setFeedback('版本已保存。')
      setApiError('')
    } catch (error) { setApiError(error.message || '保存版本失败') }
  }

  async function restoreSavedSnapshot(snapshot) {
    if (!currentProject) return
    setSnapshotToRestore(snapshot)
  }

  async function confirmSnapshotRestore() {
    const snapshot = snapshotToRestore
    if (!currentProject || !snapshot || busy) return
    setBusy(true)
    try {
      const backup = await createSnapshot(currentProject.id, `恢复前自动备份 ${new Date().toLocaleString('zh-CN')}`)
      setSnapshots((items) => [backup.snapshot, ...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      const result = await restoreSnapshot(currentProject.id, snapshot.id)
      applyProjectData(result)
      setPreviewRevision((revision) => revision + 1)
      setFeedback('版本已恢复，恢复前文件已自动备份。')
      setApiError('')
    } catch (error) { setApiError(error.message || '恢复版本失败') }
    finally { setSnapshotToRestore(null); setBusy(false) }
  }

  function downloadPreview() {
    if (!serverPreview) return
    const link = document.createElement('a')
    const url = URL.createObjectURL(new Blob([previewSrcDoc], { type: 'text/html;charset=utf-8' }))
    link.href = url
    link.download = `${(currentProject?.name || 'stars-app').replace(/[^\p{L}\p{N}-]+/gu, '-')}.html`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Icon name="sparkle" /></span><span>Stars</span><span className="beta">BETA</span></div>
        <div className="workspace-switcher"><span className="workspace-avatar">V</span><span className="workspace-name">{user ? user.email.split('@')[0] : '访客'} 的工作区</span></div>
        <nav className="side-nav" aria-label="主要导航">
          <a className="nav-item active" href="#home"><Icon name="home" />首页</a>
          <a className="nav-item" href="#projects" onClick={() => setActiveTab('模板')}><Icon name="resources" />资源</a>
          <a className="nav-item" href="#projects" onClick={() => setActiveTab('我的项目')}><Icon name="projects" />我的项目</a>
          <a className="nav-item" href="#projects" onClick={() => setActiveTab('我的项目')}><Icon name="recent" />最近项目</a>
        </nav>
        <div className="folder-label"><span>文件夹</span><button disabled title="文件夹管理尚未开放" aria-label="创建文件夹（暂不可用）"><Icon name="plus" /></button></div>
        <div className="sidebar-bottom">
          <div className="credit-card"><span className="credit-dot"><Icon name="sparkle" /></span><div><strong>按实际调用</strong><small>暂未启用积分计费</small></div></div>
          <div className="profile"><span className="profile-avatar">V</span><span><strong>{user ? '个人账户' : '访客'}</strong><small>{user ? user.email : '未登录'}</small></span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumbs"><span>Stars</span><span>/</span><strong>{currentProject?.name || '创建项目'}</strong></div><div className="top-actions"><span className={`api-status ${apiStatus}`}>{apiStatus === 'online' ? '已连接' : apiStatus === 'checking' ? '连接中' : apiStatus === 'auth-required' ? '请重新登录' : '服务不可用'}</span><button className="ghost-button" type="button" onClick={() => setFeedback('输入需求后先确认计划，再检查文件差异。确认应用变更后即可在 App Viewer 操作生成的网页。')}>帮助</button>{user ? <button className="top-avatar" disabled={running || busy} onClick={handleLogout} title="退出登录">{(user.email || 'V').slice(0, 1).toUpperCase()}</button> : <button className="login-button" onClick={() => { setAuthModal(true); setAuthMode('login') }}>登录</button>}</div></header>
        <section className="welcome-section" id="home">
          <div className="eyebrow">AI 应用生成工作台</div>
          <h1>你想创造什么？</h1>
          <p className="subhead">描述你的想法，Stars 会帮你把它变成可以运行的应用。</p>
          <section className="workflow-panel" aria-label="Stars 生成流程">
            <div className="workflow-caption">STARS SYSTEM // WORKFLOW</div>
            <div className="workflow-steps">
              {['需求分析', '架构设计', '代码编写', '测试校验', '部署预览'].map((label, index) => (
                <React.Fragment key={label}>
                  <div className={`workflow-step ${index < step || runComplete ? 'complete' : ''} ${index === step && !runComplete ? 'current' : ''}`}>
                    <span className="workflow-index">{index < step || runComplete ? '✓' : String(index + 1).padStart(2, '0')}</span>
                    <span>{label}</span>
                  </div>
                  {index < 4 && <span className="workflow-connector" aria-hidden="true" />}
                </React.Fragment>
              ))}
            </div>
          </section>
          <form className="prompt-card" onSubmit={submitPrompt}>
            <textarea maxLength="4000" disabled={running || !!plan || !!review} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例如：创建一个咖啡店预约页，包含日期选择和表单校验" aria-label="描述你的应用" rows="3" />
            <div className="prompt-toolbar"><div className="toolbar-left"><button type="button" className="tool-button" disabled title="附件上传尚未开放"><Icon name="plus" /> 添加</button><button type="button" className="tool-button" disabled title="语音输入尚未开放" aria-label="语音输入（暂不可用）"><Icon name="mic" /> 语音</button><label className="mode-select">模式 <select value={mode} onChange={(e) => setMode(e.target.value)}><option>构建</option><option>修改</option></select></label></div><button className="send-button" type="submit" disabled={!prompt.trim() || running || !!plan || !!review}>{running ? '处理中…' : '开始构建'} <Icon name="send" /></button></div>
          </form>
          <div className="agent-row" aria-label="智能体团队">{agents.map(([initial, name, role, color]) => <div className="agent-pill" key={name}><span className="agent-avatar" style={{ background: color }}>{initial}</span><span>{name}</span><small>{role}</small></div>)}</div>
        </section>

        {feedback && <div className="feedback-banner" role="status"><span>{feedback}</span><button type="button" onClick={() => setFeedback('')} aria-label="关闭提示">×</button></div>}
        <section className="content-section" id="projects">
          <div className="content-tabs" role="tablist" aria-label="项目内容">{['发现', '我的项目', '模板'].map((tab) => <button role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'tab active' : 'tab'} key={tab} onClick={() => setActiveTab(tab)}>{tab}</button>)}</div>
          {activeTab === '发现' && <div className="discovery-grid"><article className="feature-card feature-card-wide"><div><span className="card-kicker">GOOD PATH / 01</span><h2>从一句话到第一个版本</h2><p>让 Agent 规划、生成并校验你的页面，在右侧预览中立即看到结果。</p><button className="text-button" onClick={() => setPrompt('创建一个带筛选功能的咖啡菜单页')}>使用这个流程 <Icon name="arrow" /></button></div><div className="mini-window"><div className="mini-window-bar"><i></i><i></i><i></i></div><div className="mini-spark"><Icon name="sparkle" /></div><div className="mini-lines"><b></b><b></b><b></b></div></div></article><article className="feature-card"><span className="card-kicker">快速开始</span><h3>产品介绍页</h3><p>用 Stars 的风格展示一个新的想法。</p><button className="outline-button" onClick={() => setPrompt('生成一个单页 Stars 产品介绍页')}>开始创建</button></article><article className="feature-card"><span className="card-kicker">模板</span><h3>数据仪表盘</h3><p>卡片、指标和筛选器组成的工作区。</p><button className="outline-button" onClick={() => setPrompt('生成一个数据仪表盘，支持筛选和卡片排序')}>开始创建</button></article></div>}
          {activeTab === '我的项目' && <div className="project-list">{projects.length ? projects.map((project) => <div key={project.id} className="project-row"><button type="button" className="project-open" disabled={running || !!review || !!plan} onClick={() => openProject(project.id)}><span className="project-row-icon"><Icon name="projects" /></span><span><strong>{project.name}</strong><small>{project.updatedAt ? new Date(project.updatedAt).toLocaleString('zh-CN') : '刚刚创建'}</small></span><Icon name="arrow" /></button><button type="button" className="project-action" disabled={running || !!review || !!plan} onClick={() => editProject(project, 'rename')} aria-label={`重命名 ${project.name}`}>重命名</button><button type="button" className="project-action danger" disabled={running || !!review || !!plan} onClick={() => editProject(project, 'delete')} aria-label={`删除 ${project.name}`}>删除</button></div>) : <div className="empty-state"><div className="empty-icon"><Icon name="projects" /></div><h3>还没有项目</h3><p>从上方输入一句话，创建你的第一个 Stars 应用。</p><button className="outline-button" onClick={() => document.querySelector('textarea')?.focus()}>创建项目</button></div>}</div>}
          {activeTab === '模板' && <div className="template-list"><div className="template-row"><span className="template-icon"><Icon name="template" /></span><div><strong>预约与排期</strong><small>带表单校验的服务预约页面</small></div><button className="text-button" onClick={() => setPrompt('生成一个服务预约页面，包含日期选择和表单校验')}>使用模板 <Icon name="arrow" /></button></div><div className="template-row"><span className="template-icon"><Icon name="template" /></span><div><strong>作品集</strong><small>极简的项目展示与联系页面</small></div><button className="text-button" onClick={() => setPrompt('生成一个极简作品集页面，包含项目筛选')}>使用模板 <Icon name="arrow" /></button></div></div>}
        </section>

        {plan && <section className="approval-panel" aria-labelledby="plan-title"><span className="card-kicker">等待确认 / PLAN</span><h2 id="plan-title">确认生成计划</h2><p className="plan-prompt">{plan.prompt}</p><p>{plan.summary}</p><ul>{plan.files?.map(file => <li key={file.path}>{file.path} · {file.operation === 'create' ? '计划新增' : '计划修改'}</li>)}</ul><p className="empty-note">确认后调用模型生成候选文件；最终内容还需检查差异并确认后才会写入。</p><div className="confirm-actions"><button type="button" className="outline-button" onClick={() => setPlan(null)}>取消计划</button><button type="button" className="send-button" onClick={confirmPlan}>确认计划并生成</button></div></section>}
        {review && <section className="approval-panel" aria-labelledby="review-title"><span className="card-kicker">等待确认 / FILE REVIEW</span><h2 id="review-title">检查文件变更</h2><p>以下候选内容尚未写入项目。请检查差异后确认应用，或放弃本次生成。</p><FileDiff changes={review.changes} />{apiError && <p className="api-error" role="alert">{apiError}</p>}<div className="confirm-actions"><button type="button" className="outline-button" disabled={busy} onClick={() => decideReview(false)}>放弃本次生成</button><button type="button" className="send-button" disabled={busy} onClick={() => decideReview(true)}>{busy ? '处理中…' : '确认应用变更'}</button></div></section>}
        {(running || completed || apiError || currentProject) && <section className="builder-section" aria-live="polite"><div className="builder-header"><div><span className="card-kicker">{running ? '正在构建' : completed ? '构建结果' : '运行状态'}</span><h2>{running ? 'Stars 正在为你工作' : review ? '等待确认文件变更' : apiError ? '无法完成构建' : completed ? (runSource === 'stub' ? '开发模式构建完成' : '构建完成') : '尚未生成应用'}</h2>{runSource === 'stub' && completed && <p className="dev-notice">本次结果由本地 Stub 生成，未调用真实模型。</p>}{apiError && <p className="api-error" role="alert">{apiError}</p>}{apiError && running && currentProject && <button type="button" className="outline-button" onClick={() => openProject(currentProject.id)}>重新连接运行</button>}</div><span className={runComplete ? 'status-chip done' : 'status-chip'}>{review ? '等待确认' : running ? `${step + 1} / ${timeline.length}` : apiError ? '失败' : completed ? '4 / 4 完成' : '等待开始'}</span></div>{(running || completed) && <><div className="segment-progress" aria-label="生成进度">{timeline.map(([key], index) => <span className={index <= step || runComplete ? 'filled' : ''} key={key} />)}</div><div className="builder-layout"><div className="timeline">{timeline.map(([key, title, detail], index) => <div className={`timeline-item ${index < step || runComplete ? 'complete' : ''} ${index === step && !runComplete ? 'current' : ''}`} key={key}><span className="timeline-dot">{index < step || runComplete ? <Icon name="check" /> : index + 1}</span><div><strong>{title}</strong><small>{detail}</small></div></div>)}</div><div className={`preview-shell ${mobilePreview ? 'mobile' : ''}`}><div className="preview-toolbar"><div className="preview-title"><span className="live-dot"></span>App Viewer <small>{snapshots.length ? `${snapshots.length} 个已保存版本` : '当前工作副本'}</small></div><div className="preview-tools"><button onClick={() => setMobilePreview(false)} className={!mobilePreview ? 'selected' : ''} aria-label="桌面预览"><Icon name="desktop" /></button><button onClick={() => setMobilePreview(true)} className={mobilePreview ? 'selected' : ''} aria-label="移动预览"><Icon name="mobile" /></button><button onClick={() => setConsoleOpen(!consoleOpen)} className={consoleOpen ? 'selected' : ''}>控制台</button><button onClick={() => setPreviewRevision(revision => revision + 1)} aria-label="重新加载预览"><Icon name="refresh" /></button></div></div><div className="preview-canvas">{serverPreview ? <iframe ref={previewRef} key={previewRevision} className="preview-frame" title="生成应用预览" sandbox="allow-scripts" srcDoc={previewSrcDoc} /> : <div className="preview-empty"><h3>尚未生成预览</h3><p>确认生成计划和文件变更后，在此操作你的应用。</p></div>}</div>{previewErrors.length > 0 && <div className="preview-failure" role="alert"><strong>预览发生错误</strong><p>{previewErrors[0]}</p><button type="button" className="outline-button" onClick={() => { setPrompt('修复当前应用的运行错误：' + previewErrors.join('；')); document.querySelector('textarea')?.focus() }}>修复并重新生成</button></div>}{consoleOpen && <div className="console-panel" role="log">{previewErrors.length ? previewErrors.map((message, index) => <p className="api-error" key={index}>{message}</p>) : <span>尚未收到预览运行错误。</span>}</div>}</div></div><div className="files-panel"><div className="files-title"><span>项目文件</span><button type="button" disabled={!serverPreview || !currentProject || running || !!review} onClick={downloadPreview}>下载预览 HTML</button><button type="button" disabled={!serverPreview || !currentProject || running || !!review} onClick={saveSnapshot}>保存版本</button><button type="button" disabled={!serverPreview || !currentProject || running || !!review || savingFile} onClick={() => { if (editingFile) saveSelectedFile(); else { setFileDraft(selectedContent); setEditingFile(true) } }}>{savingFile ? '保存中…' : editingFile ? '保存文件' : '编辑文件'}</button><button type="button" disabled={!editingFile || savingFile} onClick={() => setEditingFile(false)}>取消编辑</button></div><div className="file-list">{files.map(([name]) => <button key={name} className={selectedFile === name ? 'file-row selected' : 'file-row'} onClick={() => { setSelectedFile(name); setEditingFile(false) }}><span className="file-type">{name.endsWith('.md') ? 'M' : name.endsWith('.css') ? '#' : name.endsWith('.js') ? 'JS' : '<>'}</span>{name}<span className="file-chevron">›</span></button>)}</div>{editingFile ? <textarea className="code-editor" aria-label={`编辑 ${selectedFile}`} value={fileDraft} onChange={event => setFileDraft(event.target.value)} /> : <pre className="code-preview"><code>{selectedContent}</code></pre>}</div>{snapshots.length > 0 && <div className="snapshot-panel"><div className="snapshot-heading"><strong>版本历史</strong><span>{snapshots.length} 个保存版本</span></div><div className="snapshot-list">{snapshots.map((snapshot) => <div className="snapshot-row" key={snapshot.id}><span><strong>{snapshot.name}</strong><small>{new Date(snapshot.createdAt).toLocaleString('zh-CN')}</small></span><button type="button" disabled={running} onClick={() => setSnapshotDiff(snapshot)}>查看差异</button><button type="button" disabled={running || !!review} onClick={() => restoreSavedSnapshot(snapshot)}>恢复</button></div>)}</div></div>}</>}</section>}
        {currentProject && <section className="history-panel" aria-label="项目历史"><h2>消息与运行历史</h2>{!messages.length && !runs.length ? <p className="empty-note">还没有运行记录。提交需求并确认计划后开始。</p> : <><div className="message-history">{messages.map(message => <article key={message.id}><strong>{message.role === 'user' ? '你' : 'Stars'}</strong><time>{new Date(message.createdAt).toLocaleString('zh-CN')}</time><p>{message.content}</p></article>)}</div><div className="run-history">{[...runs].reverse().map(run => <details key={run.id}><summary>{new Date(run.createdAt).toLocaleString('zh-CN')} · {({ done: '完成', review: '等待文件确认', rejected: '已放弃', failed: '失败', error: '失败', planned: '已规划', running: '生成中' })[run.status] || run.status} · {run.model || '规划'}</summary>{run.summary && <p>{run.summary}</p>}{run.errorCode && <p className="api-error">{run.errorCode}</p>}<ol className="event-log">{(run.details?.events || []).map((event, index) => <li key={event.id || index}><strong>{event.type}</strong><span>{event.summary}</span></li>)}</ol></details>)}</div></>}{running && <ol className="event-log" aria-label="当前运行事件">{liveEvents.map((event, index) => <li key={event.id || index}><strong>{event.type}</strong><span>{event.summary}</span></li>)}</ol>}</section>}
      </main>
      {authModal && <Modal titleId="auth-title" onClose={() => setAuthModal(false)}><form onSubmit={submitAuth}><button type="button" className="modal-close" onClick={() => setAuthModal(false)} aria-label="关闭">×</button><span className="card-kicker">STARS ACCOUNT</span><h2 id="auth-title">{authMode === 'login' ? '登录工作区' : '创建 Stars 账号'}</h2><p>登录后可以保存项目、运行记录和文件。</p><label>邮箱<input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} required autoComplete="email" /></label><label>密码<input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} required minLength="8" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} /></label>{authError && <div className="api-error">{authError}</div>}<button className="send-button" type="submit">{authMode === 'login' ? '登录' : '注册'} <Icon name="arrow" /></button><button type="button" className="auth-switch" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError('') }}>{authMode === 'login' ? '还没有账号？注册' : '已有账号？登录'}</button></form></Modal>}
      {projectDialog && <Modal titleId="project-dialog-title" onClose={() => { if (!busy) setProjectDialog(null) }}><form onSubmit={submitProjectDialog}><span className="card-kicker">项目管理</span><h2 id="project-dialog-title">{projectDialog.action === 'rename' ? '重命名项目' : '删除项目'}</h2>{projectDialog.action === 'rename' ? <label>项目名称<input value={projectName} onChange={event => setProjectName(event.target.value)} maxLength="80" required autoFocus /></label> : <p>删除“{projectDialog.project.name}”？项目将从列表中移除。</p>}{dialogError && <p className="api-error" role="alert">{dialogError}</p>}<div className="confirm-actions"><button type="button" className="outline-button" disabled={busy} onClick={() => setProjectDialog(null)}>取消</button><button className="send-button" type="submit" disabled={busy}>{busy ? '处理中…' : projectDialog.action === 'rename' ? '保存名称' : '确认删除'}</button></div></form></Modal>}
      {snapshotDiff && <Modal titleId="snapshot-diff-title" className="diff-modal" onClose={() => setSnapshotDiff(null)}><h2 id="snapshot-diff-title">版本差异：{snapshotDiff.name}</h2><p>比较当前文件与此保存版本。</p><FileDiff changes={compareFiles(files.map(([path, content]) => ({ path, content })), snapshotDiff.manifest || [])} afterLabel="保存版本" /><div className="confirm-actions"><button type="button" className="outline-button" onClick={() => setSnapshotDiff(null)}>关闭差异</button></div></Modal>}
      {snapshotToRestore && <Modal titleId="restore-title" onClose={() => { if (!busy) setSnapshotToRestore(null) }}><span className="card-kicker">版本历史</span><h2 id="restore-title">恢复到“{snapshotToRestore.name}”？</h2><p>当前文件会先自动保存为保护版本，然后替换为所选快照。</p>{apiError && <div className="api-error" role="alert">{apiError}</div>}<div className="confirm-actions"><button type="button" className="outline-button" disabled={busy} onClick={() => setSnapshotToRestore(null)}>取消</button><button type="button" className="send-button" disabled={busy} onClick={confirmSnapshotRestore}>{busy ? '恢复中…' : '确认恢复'}</button></div></Modal>}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
