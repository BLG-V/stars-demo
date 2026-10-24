import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { approveRun, createFolder, createProject, createSnapshot, deleteProject, getProject, getSession, listFolders, listProjects, login, logout, moveProjectToFolder, planProject, removeFolder, requestRegistrationCode, rejectRun, restoreSnapshot, runProject, saveProjectFile, updateFolder, updateProject, verifyRegistration } from './api'

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

const MAX_PROMPT_LENGTH = 4000
const MAX_ATTACHMENTS = 10
const MAX_ATTACHMENT_BYTES = 32 * 1024
const attachmentExtensions = new Set(['.txt', '.md', '.json', '.csv', '.html', '.css', '.js', '.ts', '.tsx', '.jsx', '.yml', '.yaml', '.xml', '.svg', '.sql'])
const excludedAttachmentDirectories = new Set(['node_modules', 'dist', 'build', 'coverage', '__pycache__', '.next', 'target', 'vendor'])
const attachmentLockFiles = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'bun.lockb'])

function buildGenerationPrompt(prompt, attachments) {
  const attachmentContext = attachments.map(file => `--- ${file.name} ---\n${file.content}`).join('\n\n')
  return `${prompt.trim()}${attachmentContext ? `\n\n参考附件（文本内容）：\n${attachmentContext}` : ''}`
}

function App() {
  const [activeTab, setActiveTab] = useState('发现')
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState([])
  const [attachmentError, setAttachmentError] = useState('')
  const [attachmentStatus, setAttachmentStatus] = useState('')
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false)
  const [attachmentImporting, setAttachmentImporting] = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceError, setVoiceError] = useState('')
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
  const [folders, setFolders] = useState([])
  const [selectedFolderId, setSelectedFolderId] = useState(null)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderError, setFolderError] = useState('')
  const [folderSubmitting, setFolderSubmitting] = useState(false)
  const [folderMenuOpen, setFolderMenuOpen] = useState(null)
  const [folderEditDialog, setFolderEditDialog] = useState(null)
  const [recentOnly, setRecentOnly] = useState(false)
  const [snapshots, setSnapshots] = useState([])
  const [currentProject, setCurrentProject] = useState(null)
  const [snapshotToRestore, setSnapshotToRestore] = useState(null)
  const [authModal, setAuthModal] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [authCodeSent, setAuthCodeSent] = useState(false)
  const [authCooldown, setAuthCooldown] = useState(0)
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [authError, setAuthError] = useState('')
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const turnstileRef = useRef(null)
  const turnstileWidgetRef = useRef(null)
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
  const attachmentInputRef = useRef(null)
  const attachmentDirectoryInputRef = useRef(null)
  const attachmentPickerRef = useRef(null)
  const attachmentTriggerRef = useRef(null)
  const attachmentMenuRef = useRef(null)
  const attachmentMenuStartRef = useRef(0)
  const attachmentImportRef = useRef(false)
  const attachmentContextRef = useRef(0)
  const voiceRecognitionRef = useRef(null)
  const promptRef = useRef(prompt)
  promptRef.current = prompt
  const previewToken = useMemo(() => crypto.randomUUID(), [files, previewRevision])
  const runComplete = completed && !running && !review && !plan && !apiError
  const generationPrompt = buildGenerationPrompt(prompt, attachments)
  const attachmentDisabled = running || !!plan || !!review || busy || attachmentImporting
  const directoryUploadSupported = 'webkitdirectory' in document.createElement('input')
  const visibleProjects = useMemo(() => {
    const filtered = selectedFolderId ? projects.filter(project => project.folderId === selectedFolderId) : projects
    return recentOnly ? [...filtered].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 8) : filtered
  }, [projects, recentOnly, selectedFolderId])

  useEffect(() => {
    if (!import.meta.env.VITE_TURNSTILE_SITE_KEY || document.querySelector('script[data-stars-turnstile]')) return undefined
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.starsTurnstile = 'true'
    document.head.appendChild(script)
    return () => script.remove()
  }, [])

  useEffect(() => {
    if (!authCooldown) return undefined
    const timer = window.setInterval(() => setAuthCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [authCooldown])

  useEffect(() => {
    if (!authModal || !turnstileRef.current || !import.meta.env.VITE_TURNSTILE_SITE_KEY) return undefined
    let widget = null
    const timer = window.setInterval(() => {
      if (!window.turnstile || widget !== null || !turnstileRef.current) return
      turnstileRef.current.innerHTML = ''
      widget = window.turnstile.render(turnstileRef.current, { sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY, theme: 'light', callback: token => setTurnstileToken(token), 'expired-callback': () => setTurnstileToken(''), 'error-callback': () => setTurnstileToken('') })
      turnstileWidgetRef.current = widget
    }, 100)
    return () => {
      window.clearInterval(timer)
      if (widget !== null) window.turnstile?.remove(widget)
      turnstileWidgetRef.current = null
      setTurnstileToken('')
    }
  }, [authModal, authMode])

  useEffect(() => {
    if (!folderMenuOpen) return undefined
    const closeOnOutsideClick = event => {
      if (!event.target.closest('.folder-entry')) setFolderMenuOpen(null)
    }
    const closeOnEscape = event => { if (event.key === 'Escape') setFolderMenuOpen(null) }
    document.addEventListener('click', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('click', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [folderMenuOpen])

  useLayoutEffect(() => {
    if (!attachmentMenuOpen) return undefined
    const menu = attachmentMenuRef.current
    const positionMenu = () => {
      const trigger = attachmentTriggerRef.current.getBoundingClientRect()
      const picker = attachmentPickerRef.current.getBoundingClientRect()
      const below = Math.max(0, window.innerHeight - trigger.bottom - 26)
      const above = Math.max(0, trigger.top - 26)
      const opensAbove = below < menu.scrollHeight && above > below
      menu.style.top = opensAbove ? 'auto' : 'calc(100% + 10px)'
      menu.style.bottom = opensAbove ? 'calc(100% + 10px)' : 'auto'
      menu.style.maxHeight = `${opensAbove ? above : below}px`
      menu.style.overflowY = 'auto'
      const width = menu.getBoundingClientRect().width
      menu.style.left = `${Math.min(Math.max(picker.left, 16), window.innerWidth - width - 16) - picker.left}px`
    }
    positionMenu()
    const items = menu.querySelectorAll('[role="menuitem"]:not(:disabled)')
    items[attachmentMenuStartRef.current < 0 ? items.length - 1 : 0]?.focus({ preventScroll: true })
    const closeOnOutsideClick = event => {
      if (!attachmentPickerRef.current?.contains(event.target)) setAttachmentMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      window.removeEventListener('resize', positionMenu)
      window.removeEventListener('scroll', positionMenu, true)
    }
  }, [attachmentMenuOpen])

  useEffect(() => {
    if (attachmentDisabled) setAttachmentMenuOpen(false)
  }, [attachmentDisabled])

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
    Promise.allSettled([getSession(), listProjects(), listFolders()]).then(([sessionResult, projectsResult, foldersResult]) => {
      if (cancelled) return
      if (sessionResult.status === 'fulfilled') setUser(sessionResult.value?.user || sessionResult.value)
      if (projectsResult.status === 'fulfilled') setProjects(projectsResult.value?.projects || projectsResult.value || [])
      if (foldersResult.status === 'fulfilled') setFolders(foldersResult.value?.folders || foldersResult.value || [])
      const hasServerResponse = sessionResult.status === 'fulfilled' || projectsResult.status === 'fulfilled' || foldersResult.status === 'fulfilled' || (sessionResult.reason?.status === 401)
      setApiStatus(hasServerResponse ? 'online' : 'offline')
      const projectId = new URLSearchParams(window.location.search).get('projectId')
      if (projectId && sessionResult.status === 'fulfilled') {
        getProject(projectId).then(projectData => { if (!cancelled) applyProjectData(projectData) }).catch(error => { if (!cancelled) setApiError(error.message || '无法恢复项目') })
      }
    })
    return () => { cancelled = true }
  }, [])

  const selectedContent = useMemo(() => files.find(([name]) => name === selectedFile)?.[1] ?? '', [files, selectedFile])

  useEffect(() => () => {
    try { voiceRecognitionRef.current?.stop() } catch { /* Recognition may already be stopped. */ }
  }, [])

  async function addAttachments(event) {
    const input = event.currentTarget
    const selected = Array.from(input.files || [])
    input.value = ''
    if (!selected.length || attachmentImportRef.current || running || plan || review || busy) return
    attachmentImportRef.current = true
    setAttachmentImporting(true)
    setAttachmentMenuOpen(false)
    setAttachmentError('')
    setAttachmentStatus('正在读取所选文本…')
    try { voiceRecognitionRef.current?.stop() } catch { /* Recognition may already be stopped. */ }
    setVoiceListening(false)
    const context = attachmentContextRef.current
    const accepted = []
    const skipped = new Map()
    const skip = reason => skipped.set(reason, (skipped.get(reason) || 0) + 1)
    try {
      for (const file of selected) {
        if (context !== attachmentContextRef.current) return
        const name = (file.webkitRelativePath || file.name).replaceAll('\\', '/')
        const segments = name.split('/')
        const filename = segments.at(-1).toLowerCase()
        if (segments.some(segment => segment.startsWith('.')) || segments.slice(0, -1).some(segment => excludedAttachmentDirectories.has(segment.toLowerCase()))) {
          skip('隐藏项或依赖/构建目录')
          continue
        }
        if (filename.endsWith('.lock') || attachmentLockFiles.has(filename)) {
          skip('锁文件')
          continue
        }
        const extension = filename.slice(filename.lastIndexOf('.'))
        if (!attachmentExtensions.has(extension)) { skip('不支持的文件类型'); continue }
        if (file.size > MAX_ATTACHMENT_BYTES) { skip('单个文件超过 32 KiB'); continue }
        if (attachments.length + accepted.length >= MAX_ATTACHMENTS) { skip(`最多 ${MAX_ATTACHMENTS} 个文本附件`); continue }
        try {
          const content = await file.text()
          if (context !== attachmentContextRef.current) return
          const hasControlCharacters = Array.from(content).some(character => {
            const code = character.charCodeAt(0)
            return code < 32 && code !== 9 && code !== 10 && code !== 13
          })
          if (hasControlCharacters) { skip('不是有效文本'); continue }
          if ([...attachments, ...accepted].some(item => item.name === name && item.content === content)) { skip('重复路径与内容'); continue }
          const attachment = { id: crypto.randomUUID(), name, content }
          if (buildGenerationPrompt(promptRef.current, [...attachments, ...accepted, attachment]).length > MAX_PROMPT_LENGTH) {
            skip('合并需求超过 4,000 字符')
            continue
          }
          accepted.push(attachment)
        } catch { skip('文件无法读取') }
      }
      if (context !== attachmentContextRef.current) return
      if (accepted.length) setAttachments(items => [...items, ...accepted])
      const skippedCount = [...skipped.values()].reduce((total, count) => total + count, 0)
      setAttachmentStatus(`已导入 ${accepted.length} 个文本文件${skippedCount ? `，跳过 ${skippedCount} 个（${[...skipped].map(([reason, count]) => `${reason} ${count} 个`).join('；')}）` : ''}。`)
    } finally {
      attachmentImportRef.current = false
      setAttachmentImporting(false)
    }
  }

  function openAttachmentMenu(event) {
    if (attachmentDisabled || attachmentImportRef.current) return
    if (event.type === 'keydown') {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      attachmentMenuStartRef.current = ['ArrowUp', 'End'].includes(event.key) ? -1 : 0
      setAttachmentMenuOpen(true)
      return
    }
    attachmentMenuStartRef.current = 0
    setAttachmentMenuOpen(open => !open)
  }

  function handleAttachmentMenuKey(event) {
    const items = [...attachmentMenuRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)')]
    const index = items.indexOf(document.activeElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setAttachmentMenuOpen(false)
      attachmentTriggerRef.current?.focus()
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[nextIndex]?.focus()
    }
  }

  function chooseAttachmentSource(directory) {
    if (attachmentDisabled || attachmentImportRef.current) return
    setAttachmentMenuOpen(false)
    if (directory && !directoryUploadSupported) {
      setAttachmentStatus('当前浏览器不支持文件夹选择，请使用“上传文件”多选文本文件。')
      attachmentTriggerRef.current?.focus()
      return
    }
    const inputRef = directory ? attachmentDirectoryInputRef : attachmentInputRef
    inputRef.current?.click()
  }

  function setSuggestedPrompt(value) {
    if (attachmentImportRef.current) return
    promptRef.current = value
    setPrompt(value)
  }

  function toggleVoiceInput() {
    if (attachmentImportRef.current) return
    if (voiceListening) {
      voiceRecognitionRef.current?.stop()
      return
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setVoiceError('当前浏览器不支持语音输入，请使用键盘输入。')
      return
    }
    setVoiceError('')
    try {
      const recognition = new SpeechRecognition()
      recognition.lang = 'zh-CN'
      recognition.continuous = false
      recognition.interimResults = false
      recognition.onresult = event => {
        if (attachmentImportRef.current) return
        const transcript = Array.from(event.results).slice(event.resultIndex).map(result => result[0].transcript).join('').trim()
        if (!transcript) return
        const current = promptRef.current
        const nextPrompt = `${current.trimEnd()}${current.trim() ? ' ' : ''}${transcript}`
        if (nextPrompt.length > MAX_PROMPT_LENGTH) {
          setVoiceError('识别内容超出 4,000 个字符限制，请精简后重试。')
          return
        }
        promptRef.current = nextPrompt
        setPrompt(nextPrompt)
      }
      recognition.onerror = event => {
        setVoiceError(event.error === 'not-allowed' ? '麦克风权限被拒绝，请在浏览器设置中允许访问麦克风。' : '语音识别暂时不可用，请重试或使用键盘输入。')
        setVoiceListening(false)
        voiceRecognitionRef.current = null
      }
      recognition.onend = () => {
        setVoiceListening(false)
        voiceRecognitionRef.current = null
      }
      voiceRecognitionRef.current = recognition
      recognition.start()
      setVoiceListening(true)
    } catch {
      voiceRecognitionRef.current = null
      setVoiceListening(false)
      setVoiceError('无法启动语音输入，请检查浏览器麦克风权限。')
    }
  }

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
    attachmentContextRef.current += 1
    setAttachmentStatus('')
    setAttachmentMenuOpen(false)
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
    if (!prompt.trim() || running || attachmentImportRef.current) return
    if (generationPrompt.length > MAX_PROMPT_LENGTH) {
      setAttachmentError('提示词和附件内容合计不能超过 4,000 个字符。')
      return
    }
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
      const project = currentProject || await createProject(`Stars ${new Date().toLocaleDateString('zh-CN')}`, generationPrompt.trim(), selectedFolderId)
      const projectData = project?.project || project
      setCurrentProject(projectData)
      window.history.replaceState({}, '', `/?projectId=${encodeURIComponent(projectData.id)}`)
      setProjects((items) => [projectData, ...items.filter((item) => item.id !== projectData.id)])
      const result = await planProject(projectData.id, generationPrompt.trim())
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

  function resetTurnstile() {
    setTurnstileToken('')
    if (turnstileWidgetRef.current !== null) window.turnstile?.reset(turnstileWidgetRef.current)
  }

  async function submitAuth(event) {
    event.preventDefault()
    setAuthError('')
    if (import.meta.env.VITE_TURNSTILE_SITE_KEY && !turnstileToken) { setAuthError('请先完成 Cloudflare 人机校验'); return }
    if (authMode === 'register' && !authCodeSent) {
      setAuthSubmitting(true)
      try {
        await requestRegistrationCode(authEmail, turnstileToken)
        setAuthCodeSent(true)
        setAuthCooldown(60)
        setFeedback('验证码已发送，请检查邮箱。')
      } catch (error) { setAuthError(error.message || '验证码发送失败，请稍后重试') }
      finally { resetTurnstile(); setAuthSubmitting(false) }
      return
    }
    if (authMode === 'register' && !/^\d{6}$/.test(authCode)) {
      setAuthError('请输入 6 位邮箱验证码')
      return
    }
    setAuthSubmitting(true)
    try {
      const result = authMode === 'login' ? await login(authEmail, authPassword, turnstileToken) : await verifyRegistration(authEmail, authCode, authPassword, turnstileToken)
      setUser(result?.user || result)
      const projectList = await listProjects()
      setProjects(projectList?.projects || projectList || [])
      const folderList = await listFolders()
      setFolders(folderList?.folders || folderList || [])
      const projectId = new URLSearchParams(window.location.search).get('projectId')
      if (projectId) applyProjectData(await getProject(projectId))
      setAuthModal(false)
      setAuthPassword('')
      setAuthError('')
      setTurnstileToken('')
      setApiStatus('online')
    } catch (error) {
      setAuthError(error.message || '认证失败，请检查输入')
    } finally { resetTurnstile(); setAuthSubmitting(false) }
  }

  async function resendRegistrationCode() {
    if (!authEmail || authCooldown > 0 || authSubmitting) return
    setAuthError('')
    if (import.meta.env.VITE_TURNSTILE_SITE_KEY && !turnstileToken) { setAuthError('请先完成 Cloudflare 人机校验'); return }
    setAuthSubmitting(true)
    try {
      await requestRegistrationCode(authEmail, turnstileToken)
      setAuthCooldown(60)
      setFeedback('新的验证码已发送，请检查邮箱。')
    } catch (error) { setAuthError(error.message || '验证码发送失败，请稍后重试') }
    finally { resetTurnstile(); setAuthSubmitting(false) }
  }

  function switchAuthMode(mode) {
    setAuthMode(mode)
    setAuthError('')
    setAuthCode('')
    setAuthCodeSent(false)
    setAuthCooldown(0)
  }

  async function handleLogout() {
    if (attachmentImportRef.current || running || busy) return
    attachmentContextRef.current += 1
    setAttachmentMenuOpen(false)
    try { await logout() } catch { /* A local session can still be cleared if the API is unavailable. */ }
    setAccountMenuOpen(false)
    setUser(null)
    setCurrentProject(null)
    setSnapshots([])
    setProjects([])
    setFolders([])
    setSelectedFolderId(null)
    setRecentOnly(false)
    setFolderMenuOpen(null)
    setFiles([])
    setMessages([])
    setRuns([])
    setPlan(null)
    setReview(null)
    setAttachments([])
    setAttachmentStatus('')
    setAttachmentError('')
    setCompleted(false)
    setServerPreview(false)
    window.history.replaceState({}, '', '/')
  }

  function startNewProject() {
    if (running || plan || review || busy || savingFile || attachmentImportRef.current) return
    attachmentContextRef.current += 1
    setAttachmentMenuOpen(false)
    activeRunRef.current?.controller.abort()
    activeRunRef.current = null
    voiceRecognitionRef.current?.stop()
    setVoiceListening(false)
    setCurrentProject(null)
    setFiles([])
    setSnapshots([])
    setMessages([])
    setRuns([])
    setLiveEvents([])
    setCompleted(false)
    setServerPreview(false)
    setPreviewErrors([])
    setEditingFile(false)
    setFileDraft('')
    setSelectedFile('index.html')
    setStep(0)
    setRunSource('backend')
    setApiError('')
    setFeedback('')
    setPrompt('')
    promptRef.current = ''
    setAttachments([])
    setAttachmentError('')
    setAttachmentStatus('')
    setVoiceError('')
    window.history.replaceState({}, '', '/')
    document.querySelector('textarea')?.focus()
  }

  async function openProject(projectId) {
    if (attachmentImportRef.current) return
    try {
      const result = await getProject(projectId)
      applyProjectData(result)
      setActiveTab('我的项目')
      setSelectedFolderId(null)
      setRecentOnly(false)
      window.history.replaceState({}, '', `/?projectId=${encodeURIComponent(projectId)}`)
      setApiError('')
    } catch (error) { setApiError(error.message || '无法打开项目') }
  }

  async function submitProjectDialog(event) {
    event.preventDefault()
    if (!projectDialog || busy || attachmentImportRef.current) return
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
    if (attachmentImportRef.current) return
    setProjectDialog({ project, action })
    setProjectName(project.name)
    setDialogError('')
  }

  function openFolderDialog() {
    if (!user) {
      setAuthMode('login')
      setAuthModal(true)
      setAuthError('登录后可以管理文件夹。')
      return
    }
    setFolderName('')
    setFolderError('')
    setFolderDialogOpen(true)
  }

  async function submitFolder(event) {
    event.preventDefault()
    if (!folderName.trim() || folderSubmitting) return
    setFolderSubmitting(true)
    setFolderError('')
    try {
      const result = await createFolder(folderName.trim())
      const folder = result.folder
      setFolders(items => [...items, folder].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
      setSelectedFolderId(folder.id)
      setRecentOnly(false)
      setActiveTab('我的项目')
      setFolderDialogOpen(false)
      setFeedback(`已创建文件夹“${folder.name}”。`)
    } catch (error) { setFolderError(error.message || '创建文件夹失败，请重试。') }
    finally { setFolderSubmitting(false) }
  }

  function openFolderEditor(folder, action) {
    setFolderMenuOpen(null)
    setFolderName(folder.name)
    setFolderError('')
    setFolderEditDialog({ folder, action })
  }

  async function submitFolderEditor(event) {
    event.preventDefault()
    if (!folderEditDialog || folderSubmitting) return
    const { folder, action } = folderEditDialog
    setFolderSubmitting(true)
    setFolderError('')
    try {
      if (action === 'rename') {
        const name = folderName.trim()
        if (!name) {
          setFolderError('请输入文件夹名称。')
          return
        }
        const result = await updateFolder(folder.id, name)
        const updated = result.folder
        setFolders(items => [...items.filter(item => item.id !== updated.id), updated].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))))
        setFeedback('文件夹已重命名。')
      } else {
        await removeFolder(folder.id)
        setFolders(items => items.filter(item => item.id !== folder.id))
        setProjects(items => items.map(project => project.folderId === folder.id ? { ...project, folderId: null } : project))
        if (selectedFolderId === folder.id) {
          setSelectedFolderId(null)
          setActiveTab('我的项目')
        }
        if (currentProject?.folderId === folder.id) setCurrentProject(project => project ? { ...project, folderId: null } : project)
        setFeedback('文件夹已删除，项目已移入未分类。')
      }
      setFolderEditDialog(null)
      setApiError('')
    } catch (error) {
      setFolderError(error.message || '文件夹操作失败，请重试。')
    } finally { setFolderSubmitting(false) }
  }

  async function changeProjectFolder(projectId, folderId) {
    if (busy || running || plan || review || attachmentImportRef.current) return
    setBusy(true)
    try {
      const result = await moveProjectToFolder(projectId, folderId)
      const updated = result.project
      setProjects(items => items.map(project => project.id === updated.id ? updated : project))
      if (currentProject?.id === updated.id) setCurrentProject(updated)
      setFeedback(folderId ? '项目已移入文件夹。' : '项目已移出文件夹。')
      setApiError('')
    } catch (error) { setApiError(error.message || '移动项目失败，请重试。') }
    finally { setBusy(false) }
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
    <div className={`app-shell ${user ? 'authenticated-shell' : 'public-shell'}`}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Icon name="sparkle" /></span><span>Stars</span><span className="beta">BETA</span></div>
        <div className="workspace-switcher"><span className="workspace-avatar">V</span><span className="workspace-name">{user ? user.email.split('@')[0] : '访客'} 的工作区</span></div>
        <nav className="side-nav" aria-label="主要导航">
           <a className={`nav-item ${activeTab === '发现' ? 'active' : ''}`} href="#home" onClick={() => setActiveTab('发现')}><Icon name="home" />首页</a>
           <a className={`nav-item ${activeTab === '模板' ? 'active' : ''}`} href="#projects" onClick={() => setActiveTab('模板')}><Icon name="resources" />资源</a>
           <a className={`nav-item ${activeTab === '我的项目' && !recentOnly && !selectedFolderId ? 'active' : ''}`} href="#projects" onClick={() => { setSelectedFolderId(null); setRecentOnly(false); setActiveTab('我的项目') }}><Icon name="projects" />我的项目</a>
           <a className={`nav-item ${activeTab === '我的项目' && recentOnly ? 'active' : ''}`} href="#projects" onClick={() => { setSelectedFolderId(null); setRecentOnly(true); setActiveTab('我的项目') }}><Icon name="recent" />最近项目</a>
        </nav>
        <div className="folder-label"><span>文件夹</span><button type="button" onClick={openFolderDialog} title="新建文件夹" aria-label="创建文件夹"><Icon name="plus" /></button></div>
        <div className="folder-list" aria-label="文件夹">
          <button type="button" className={`folder-item ${selectedFolderId ? '' : 'selected'}`} aria-pressed={!selectedFolderId} onClick={() => { setSelectedFolderId(null); setRecentOnly(false); setActiveTab('我的项目') }}><span className="folder-item-icon"><Icon name="projects" /></span><span className="folder-item-name">全部项目</span><small>{projects.length}</small></button>
           {folders.map(folder => <div className="folder-entry" key={folder.id}><button type="button" className={`folder-item ${selectedFolderId === folder.id ? 'selected' : ''}`} aria-pressed={selectedFolderId === folder.id} onClick={() => { setFolderMenuOpen(null); setSelectedFolderId(folder.id); setRecentOnly(false); setActiveTab('我的项目') }}><span className="folder-item-icon"><Icon name="template" /></span><span className="folder-item-name">{folder.name}</span><small>{projects.filter(project => project.folderId === folder.id).length}</small></button><button type="button" className="folder-more" aria-label={`管理文件夹 ${folder.name}`} aria-haspopup="menu" aria-expanded={folderMenuOpen === folder.id} onClick={event => { event.stopPropagation(); setFolderMenuOpen(open => open === folder.id ? null : folder.id) }}>···</button>{folderMenuOpen === folder.id && <div className="folder-menu" role="menu" aria-label={`${folder.name} 文件夹操作`}><button type="button" role="menuitem" onClick={() => openFolderEditor(folder, 'rename')}>重命名</button><button type="button" role="menuitem" onClick={() => openFolderEditor(folder, 'delete')}>删除</button></div>}</div>)}
          {user && folders.length === 0 && <p className="folder-empty">还没有文件夹</p>}
        </div>
        <div className="sidebar-bottom">
          <div className="credit-card"><span className="credit-dot"><Icon name="sparkle" /></span><div><strong>按实际调用</strong><small>暂未启用积分计费</small></div></div>
          <div className="profile-wrap">
            <button className="profile" type="button" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => {
              if (!user) { setAuthMode('login'); setAuthModal(true); return }
              setAccountMenuOpen(open => !open)
            }}>
              <span className="profile-avatar">{(user?.email || 'V').slice(0, 1).toUpperCase()}</span>
              <span><strong>{user ? '个人账户' : '访客'}</strong><small>{user ? user.email : '未登录'}</small></span>
              <Icon name="chevron" />
            </button>
            {accountMenuOpen && user && <div className="profile-menu" role="menu" aria-label="个人账户菜单">
              <div className="profile-menu-heading"><strong>{user.email}</strong><small>已登录 Stars 工作区</small></div>
              <button type="button" role="menuitem" onClick={handleLogout} disabled={running || busy || attachmentImporting}>退出登录</button>
            </div>}
          </div>
        </div>
      </aside>

      <main className="main-content">
        {!user && <div className="public-chrome"><button type="button" className="public-menu-button" aria-label="打开菜单"><span></span><span></span><span></span></button><button type="button" className="public-login-button" onClick={() => { setAuthModal(true); setAuthMode('login') }}>登录</button></div>}
        {!user && <nav className="public-nav" aria-label="Stars 公开导航"><a className="public-brand" href="#home"><span className="brand-mark"><Icon name="sparkle" /></span><strong>Stars</strong></a><div className="public-nav-links"><a href="#capabilities">产品</a><a href="#agents">AI Agents</a><a href="#stories">案例</a><a href="#faq">FAQ</a></div><div className="public-nav-actions"><button type="button" className="public-nav-login" onClick={() => { setAuthModal(true); setAuthMode('login') }}>登录</button><button type="button" className="public-nav-signup" onClick={() => { setAuthModal(true); setAuthMode('register') }}>注册</button></div></nav>}
        <header className="topbar"><div className="breadcrumbs"><span>Stars</span><span>/</span><strong>{currentProject?.name || '创建项目'}</strong></div><div className="top-actions"><span className={`api-status ${apiStatus}`}>{apiStatus === 'online' ? '已连接' : apiStatus === 'checking' ? '连接中' : apiStatus === 'auth-required' ? '请重新登录' : '服务不可用'}</span><button className="ghost-button" type="button" onClick={() => setFeedback('输入需求后先确认计划，再检查文件差异。确认应用变更后即可在 App Viewer 操作生成的网页。')}>帮助</button>{user ? <button className="top-avatar" disabled={running || busy || attachmentImporting} onClick={handleLogout} title="退出登录">{(user.email || 'V').slice(0, 1).toUpperCase()}</button> : <button className="login-button" onClick={() => { setAuthModal(true); setAuthMode('login') }}>登录</button>}</div></header>
        <section className="welcome-section" id="home">
          <div className="eyebrow">AI 应用生成工作台</div>
          <h1>{user ? '你的下一个产品，从这里开始' : '用 AI 构建网站与应用，无需编码'}</h1>
          <p className="subhead">描述你的想法，Stars 会帮你把它变成可以运行的应用。</p>
          {(!user || running || plan || review || runs.length > 0 || files.length > 0) && <section className="workflow-panel" aria-label="Stars 生成流程">
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
          </section>}
          <form className="prompt-card" onSubmit={submitPrompt}>
            <textarea maxLength={MAX_PROMPT_LENGTH} disabled={attachmentDisabled} value={prompt} onChange={(event) => { if (attachmentImportRef.current) return; promptRef.current = event.target.value; setPrompt(event.target.value) }} placeholder="例如：创建一个咖啡店预约页，包含日期选择和表单校验" aria-label="描述你的应用" rows="3" />
            {attachments.length > 0 && <div className="snapshot-list attachment-list" aria-label="已添加附件">{attachments.map(file => <div className="snapshot-row" key={file.id}><span><strong>{file.name}</strong><small>{file.content.length} 个字符</small></span><button type="button" className="project-action danger" disabled={attachmentDisabled} aria-label={`移除附件 ${file.name}`} onClick={() => { if (attachmentImportRef.current) return; setAttachments(items => items.filter(item => item.id !== file.id)); setAttachmentError(''); setAttachmentStatus('') }}>移除</button></div>)}</div>}
            {attachmentError && <p className="api-error" role="alert">{attachmentError}</p>}
            {attachmentStatus && <p className="attachment-status" role="status">{attachmentStatus}</p>}
            {voiceError && <p className="empty-note" role="status">{voiceError}</p>}
            <div className="prompt-toolbar"><div className="toolbar-left"><div className="attachment-picker" ref={attachmentPickerRef} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setAttachmentMenuOpen(false) }}>
              <input ref={attachmentInputRef} style={{ display: 'none' }} type="file" multiple accept=".txt,.md,.json,.csv,.html,.css,.js,.ts,.tsx,.jsx,.yml,.yaml,.xml,.svg,.sql" aria-label="添加文本附件" disabled={attachmentDisabled} onChange={addAttachments} />
              <input ref={element => { attachmentDirectoryInputRef.current = element; if (element) element.setAttribute('webkitdirectory', '') }} style={{ display: 'none' }} type="file" multiple aria-label="上传文本文件夹" disabled={attachmentDisabled} onChange={addAttachments} />
              <button ref={attachmentTriggerRef} type="button" className="tool-button" disabled={attachmentDisabled} aria-haspopup="menu" aria-controls="attachment-menu" aria-expanded={attachmentMenuOpen} title="添加文本文件或文件夹作为参考上下文" onClick={openAttachmentMenu} onKeyDown={openAttachmentMenu}><Icon name="plus" /> {attachmentImporting ? '导入中…' : '添加'}</button>
              {attachmentMenuOpen && <div ref={attachmentMenuRef} id="attachment-menu" className="attachment-menu" role="menu" aria-label="添加参考内容" onKeyDown={handleAttachmentMenuKey}>
                <button type="button" className="attachment-menu-item" role="menuitem" tabIndex="-1" disabled={attachmentDisabled} onClick={() => chooseAttachmentSource(false)}><Icon name="template" /><span>上传文件</span></button>
                <button type="button" className="attachment-menu-item" role="menuitem" tabIndex="-1" disabled={attachmentDisabled} onClick={() => chooseAttachmentSource(true)}><Icon name="projects" /><span>上传文件夹</span></button>
                <p className="attachment-hint">仅导入文本内容 · 最多 10 个 · 单个 32 KiB<br />合并需求不超过 4,000 字符{!directoryUploadSupported && <><br />当前浏览器不支持文件夹选择，请多选文件。</>}</p>
              </div>}
            </div><button type="button" className="tool-button" disabled={attachmentDisabled} title="通过麦克风识别中文语音" aria-label={voiceListening ? '停止语音输入' : '语音输入'} aria-pressed={voiceListening} onClick={toggleVoiceInput}><Icon name="mic" /> {voiceListening ? '停止' : '语音'}</button><label className="mode-select">模式 <select value={mode} disabled={attachmentDisabled} onChange={(e) => setMode(e.target.value)}><option>构建</option><option>修改</option></select></label></div><button className="send-button" type="submit" disabled={!prompt.trim() || generationPrompt.length > MAX_PROMPT_LENGTH || attachmentDisabled}>{running ? '处理中…' : '开始构建'} <Icon name="send" /></button></div>
          </form>
          <div className="agent-row" aria-label="智能体团队">{agents.map(([initial, name, role, color]) => <div className="agent-pill" key={name}><span className="agent-avatar" style={{ background: color }}>{initial}</span><span>{name}</span><small>{role}</small></div>)}</div>
        </section>

        {feedback && <div className="feedback-banner" role="status"><span>{feedback}</span><button type="button" onClick={() => setFeedback('')} aria-label="关闭提示">×</button></div>}
        <section className="content-section" id="projects">
          <div className="content-tabs" role="tablist" aria-label="项目内容">{['发现', '我的项目', '模板'].map((tab) => <button role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'tab active' : 'tab'} key={tab} onClick={() => { setActiveTab(tab); if (tab === '我的项目') { setSelectedFolderId(null); setRecentOnly(false) } }}>{tab}</button>)}</div>
          {activeTab === '发现' && <div className="discovery-grid"><article className="feature-card feature-card-wide"><div><span className="card-kicker">GOOD PATH / 01</span><h2>从一句话到第一个版本</h2><p>让 Agent 规划、生成并校验你的页面，在右侧预览中立即看到结果。</p><button className="text-button" disabled={attachmentImporting} onClick={() => setSuggestedPrompt('创建一个带筛选功能的咖啡菜单页')}>使用这个流程 <Icon name="arrow" /></button></div><div className="mini-window"><div className="mini-window-bar"><i></i><i></i><i></i></div><div className="mini-spark"><Icon name="sparkle" /></div><div className="mini-lines"><b></b><b></b><b></b></div></div></article><article className="feature-card"><span className="card-kicker">快速开始</span><h3>产品介绍页</h3><p>用 Stars 的风格展示一个新的想法。</p><button className="outline-button" disabled={attachmentImporting} onClick={() => setSuggestedPrompt('生成一个单页 Stars 产品介绍页')}>开始创建</button></article><article className="feature-card"><span className="card-kicker">模板</span><h3>数据仪表盘</h3><p>卡片、指标和筛选器组成的工作区。</p><button className="outline-button" disabled={attachmentImporting} onClick={() => setSuggestedPrompt('生成一个数据仪表盘，支持筛选和卡片排序')}>开始创建</button></article></div>}
          {activeTab === '我的项目' && <div className="project-list">
            <div className="project-list-heading">
              <div><h2>{recentOnly ? '最近项目' : selectedFolderId ? (folders.find(folder => folder.id === selectedFolderId)?.name || '文件夹项目') : '我的项目'}</h2><p>{visibleProjects.length} 个项目{recentOnly ? ' · 最近更新' : ''}</p></div>
              <button type="button" className="outline-button" disabled={running || !!plan || !!review || busy || savingFile || attachmentImporting} onClick={startNewProject}>新建项目</button>
            </div>
            {visibleProjects.length ? visibleProjects.map(project => <div key={project.id} className="project-row"><button type="button" className="project-open" disabled={running || !!review || !!plan || attachmentImporting} onClick={() => openProject(project.id)}><span className="project-row-icon"><Icon name="projects" /></span><span><strong>{project.name}</strong><small>{project.updatedAt ? new Date(project.updatedAt).toLocaleString('zh-CN') : '刚刚创建'}</small></span><Icon name="arrow" /></button><select className="project-folder-select" aria-label={'移动 ' + project.name + ' 到文件夹'} value={project.folderId || ''} disabled={running || !!review || !!plan || busy || attachmentImporting} onChange={event => changeProjectFolder(project.id, event.target.value)}><option value="">未分类</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><button type="button" className="project-action" disabled={running || !!review || !!plan || busy || attachmentImporting} onClick={() => editProject(project, 'rename')} aria-label={'重命名 ' + project.name}>重命名</button><button type="button" className="project-action danger" disabled={running || !!review || !!plan || busy || attachmentImporting} onClick={() => editProject(project, 'delete')} aria-label={'删除 ' + project.name}>删除</button></div>) : <div className="empty-state"><div className="empty-icon"><Icon name="projects" /></div><h3>{selectedFolderId ? '这个文件夹还没有项目' : recentOnly ? '还没有最近项目' : '还没有项目'}</h3><p>{selectedFolderId ? '创建新项目时会自动放入当前文件夹。' : '从上方输入一句话，创建你的第一个 Stars 应用。'}</p><button type="button" className="outline-button" disabled={running || !!plan || !!review || busy || savingFile || attachmentImporting} onClick={startNewProject}>创建项目</button></div>}
          </div>}
          {activeTab === '模板' && <div className="template-list"><div className="template-row"><span className="template-icon"><Icon name="template" /></span><div><strong>预约与排期</strong><small>带表单校验的服务预约页面</small></div><button className="text-button" disabled={attachmentImporting} onClick={() => setSuggestedPrompt('生成一个服务预约页面，包含日期选择和表单校验')}>使用模板 <Icon name="arrow" /></button></div><div className="template-row"><span className="template-icon"><Icon name="template" /></span><div><strong>作品集</strong><small>极简的项目展示与联系页面</small></div><button className="text-button" disabled={attachmentImporting} onClick={() => setSuggestedPrompt('生成一个极简作品集页面，包含项目筛选')}>使用模板 <Icon name="arrow" /></button></div></div>}
        </section>

        {!user && <section className="public-sections" aria-label="Stars 产品介绍">
          <section className="public-section" id="capabilities"><div className="public-section-heading"><span>Stars 能够做什么？</span><h2>从一个想法，开始构建真实产品</h2><p>用自然语言描述目标，Stars 会组织智能体完成规划、生成、验证和预览。</p></div><div className="public-capability-grid"><button type="button" className="public-capability-card" disabled={attachmentImporting} onClick={() => setSuggestedPrompt('创建一个 SaaS 产品介绍页')}><span className="capability-icon">✦</span><strong>SaaS 产品</strong><small>清晰的产品页面与转化流程</small></button><button type="button" className="public-capability-card" disabled={attachmentImporting} onClick={() => setSuggestedPrompt('创建一个内容媒体首页')}><span className="capability-icon">◌</span><strong>内容媒体</strong><small>编辑、内容和阅读体验</small></button><button type="button" className="public-capability-card" disabled={attachmentImporting} onClick={() => setSuggestedPrompt('创建一个数据仪表盘')}><span className="capability-icon">▦</span><strong>数据应用</strong><small>指标、筛选和可视化工作区</small></button><button type="button" className="public-capability-card" disabled={attachmentImporting} onClick={() => setSuggestedPrompt('创建一个推荐平台首页')}><span className="capability-icon">⌁</span><strong>推荐平台</strong><small>搜索、推荐和互动体验</small></button></div></section>
          <section className="public-proof" id="stories"><div><strong>一个团队，一条完整链路</strong><p>从需求澄清到可运行预览，每一步都能被看见、检查和恢复。</p></div><div className="public-proof-stats"><span><b>5</b><small>生成阶段</small></span><span><b>8</b><small>专业 Agents</small></span><span><b>100%</b><small>可审阅变更</small></span></div></section>
          <section className="public-section public-agents" id="agents"><div className="public-section-heading"><span>AI Agents</span><h2>一支围绕你工作的智能团队</h2><p>不同角色协作推进同一个项目，让每次生成都有明确的上下文。</p></div><div className="public-agent-grid">{agents.map(([initial, name, role, color]) => <div className="public-agent-card" key={name}><span className="agent-avatar" style={{ background: color }}>{initial}</span><div><strong>{name}</strong><small>{role}</small></div></div>)}</div></section>
          <section className="public-faq" id="faq"><div><span>常见问题</span><h2>开始之前，先了解 Stars</h2></div><div className="public-faq-list"><details><summary>我需要会写代码吗？</summary><p>不需要。你可以用自然语言描述目标，生成后再通过文件审阅和预览进行确认。</p></details><details><summary>生成的内容可以修改吗？</summary><p>可以。Stars 会展示候选文件和差异，确认后才写入项目，也支持继续编辑和恢复版本。</p></details><details><summary>我的数据会被保存吗？</summary><p>项目、文件和运行状态会按账户持久化，服务端负责权限校验和会话保护。</p></details></div></section>
          <footer className="public-footer"><a className="public-brand" href="#home"><span className="brand-mark"><Icon name="sparkle" /></span><strong>Stars</strong></a><span>用 AI，把想法变成可以运行的应用。</span><small>© 2026 Stars</small></footer>
        </section>}

        {plan && <section className="approval-panel" aria-labelledby="plan-title"><span className="card-kicker">等待确认 / PLAN</span><h2 id="plan-title">确认生成计划</h2><p className="plan-prompt">{plan.prompt}</p><p>{plan.summary}</p><ul>{plan.files?.map(file => <li key={file.path}>{file.path} · {file.operation === 'create' ? '计划新增' : '计划修改'}</li>)}</ul><p className="empty-note">确认后调用模型生成候选文件；最终内容还需检查差异并确认后才会写入。</p><div className="confirm-actions"><button type="button" className="outline-button" onClick={() => setPlan(null)}>取消计划</button><button type="button" className="send-button" onClick={confirmPlan}>确认计划并生成</button></div></section>}
        {review && <section className="approval-panel" aria-labelledby="review-title"><span className="card-kicker">等待确认 / FILE REVIEW</span><h2 id="review-title">检查文件变更</h2><p>以下候选内容尚未写入项目。请检查差异后确认应用，或放弃本次生成。</p><FileDiff changes={review.changes} />{apiError && <p className="api-error" role="alert">{apiError}</p>}<div className="confirm-actions"><button type="button" className="outline-button" disabled={busy} onClick={() => decideReview(false)}>放弃本次生成</button><button type="button" className="send-button" disabled={busy} onClick={() => decideReview(true)}>{busy ? '处理中…' : '确认应用变更'}</button></div></section>}
        {(running || completed || apiError || currentProject) && <section className="builder-section" aria-live="polite"><div className="builder-header"><div><span className="card-kicker">{running ? '正在构建' : completed ? '构建结果' : '运行状态'}</span><h2>{running ? 'Stars 正在为你工作' : review ? '等待确认文件变更' : apiError ? '无法完成构建' : completed ? (runSource === 'stub' ? '开发模式构建完成' : '构建完成') : '尚未生成应用'}</h2>{runSource === 'stub' && completed && <p className="dev-notice">本次结果由本地 Stub 生成，未调用真实模型。</p>}{apiError && <p className="api-error" role="alert">{apiError}</p>}{apiError && running && currentProject && <button type="button" className="outline-button" onClick={() => openProject(currentProject.id)}>重新连接运行</button>}</div><span className={runComplete ? 'status-chip done' : 'status-chip'}>{review ? '等待确认' : running ? `${step + 1} / ${timeline.length}` : apiError ? '失败' : completed ? '4 / 4 完成' : '等待开始'}</span></div>{(running || completed) && <><div className="segment-progress" aria-label="生成进度">{timeline.map(([key], index) => <span className={index <= step || runComplete ? 'filled' : ''} key={key} />)}</div><div className="builder-layout"><div className="timeline">{timeline.map(([key, title, detail], index) => <div className={`timeline-item ${index < step || runComplete ? 'complete' : ''} ${index === step && !runComplete ? 'current' : ''}`} key={key}><span className="timeline-dot">{index < step || runComplete ? <Icon name="check" /> : index + 1}</span><div><strong>{title}</strong><small>{detail}</small></div></div>)}</div><div className={`preview-shell ${mobilePreview ? 'mobile' : ''}`}><div className="preview-toolbar"><div className="preview-title"><span className="live-dot"></span>App Viewer <small>{snapshots.length ? `${snapshots.length} 个已保存版本` : '当前工作副本'}</small></div><div className="preview-tools"><button onClick={() => setMobilePreview(false)} className={!mobilePreview ? 'selected' : ''} aria-label="桌面预览"><Icon name="desktop" /></button><button onClick={() => setMobilePreview(true)} className={mobilePreview ? 'selected' : ''} aria-label="移动预览"><Icon name="mobile" /></button><button onClick={() => setConsoleOpen(!consoleOpen)} className={consoleOpen ? 'selected' : ''}>控制台</button><button onClick={() => setPreviewRevision(revision => revision + 1)} aria-label="重新加载预览"><Icon name="refresh" /></button></div></div><div className="preview-canvas">{serverPreview ? <iframe ref={previewRef} key={previewRevision} className="preview-frame" title="生成应用预览" sandbox="allow-scripts" srcDoc={previewSrcDoc} /> : <div className="preview-empty"><h3>尚未生成预览</h3><p>确认生成计划和文件变更后，在此操作你的应用。</p></div>}</div>{previewErrors.length > 0 && <div className="preview-failure" role="alert"><strong>预览发生错误</strong><p>{previewErrors[0]}</p><button type="button" className="outline-button" disabled={attachmentImporting} onClick={() => { setSuggestedPrompt('修复当前应用的运行错误：' + previewErrors.join('；')); document.querySelector('textarea')?.focus() }}>修复并重新生成</button></div>}{consoleOpen && <div className="console-panel" role="log">{previewErrors.length ? previewErrors.map((message, index) => <p className="api-error" key={index}>{message}</p>) : <span>尚未收到预览运行错误。</span>}</div>}</div></div><div className="files-panel"><div className="files-title"><span>项目文件</span><button type="button" disabled={!serverPreview || !currentProject || running || !!review} onClick={downloadPreview}>下载预览 HTML</button><button type="button" disabled={!serverPreview || !currentProject || running || !!review} onClick={saveSnapshot}>保存版本</button><button type="button" disabled={!serverPreview || !currentProject || running || !!review || savingFile} onClick={() => { if (editingFile) saveSelectedFile(); else { setFileDraft(selectedContent); setEditingFile(true) } }}>{savingFile ? '保存中…' : editingFile ? '保存文件' : '编辑文件'}</button><button type="button" disabled={!editingFile || savingFile} onClick={() => setEditingFile(false)}>取消编辑</button></div><div className="file-list">{files.map(([name]) => <button key={name} className={selectedFile === name ? 'file-row selected' : 'file-row'} onClick={() => { setSelectedFile(name); setEditingFile(false) }}><span className="file-type">{name.endsWith('.md') ? 'M' : name.endsWith('.css') ? '#' : name.endsWith('.js') ? 'JS' : '<>'}</span>{name}<span className="file-chevron">›</span></button>)}</div>{editingFile ? <textarea className="code-editor" aria-label={`编辑 ${selectedFile}`} value={fileDraft} onChange={event => setFileDraft(event.target.value)} /> : <pre className="code-preview"><code>{selectedContent}</code></pre>}</div>{snapshots.length > 0 && <div className="snapshot-panel"><div className="snapshot-heading"><strong>版本历史</strong><span>{snapshots.length} 个保存版本</span></div><div className="snapshot-list">{snapshots.map((snapshot) => <div className="snapshot-row" key={snapshot.id}><span><strong>{snapshot.name}</strong><small>{new Date(snapshot.createdAt).toLocaleString('zh-CN')}</small></span><button type="button" disabled={running} onClick={() => setSnapshotDiff(snapshot)}>查看差异</button><button type="button" disabled={running || !!review} onClick={() => restoreSavedSnapshot(snapshot)}>恢复</button></div>)}</div></div>}</>}</section>}
        {currentProject && <section className="history-panel" aria-label="项目历史"><h2>消息与运行历史</h2>{!messages.length && !runs.length ? <p className="empty-note">还没有运行记录。提交需求并确认计划后开始。</p> : <><div className="message-history">{messages.map(message => <article key={message.id}><strong>{message.role === 'user' ? '你' : 'Stars'}</strong><time>{new Date(message.createdAt).toLocaleString('zh-CN')}</time><p>{message.content}</p></article>)}</div><div className="run-history">{[...runs].reverse().map(run => <details key={run.id}><summary>{new Date(run.createdAt).toLocaleString('zh-CN')} · {({ done: '完成', review: '等待文件确认', rejected: '已放弃', failed: '失败', error: '失败', planned: '已规划', running: '生成中' })[run.status] || run.status} · {run.model || '规划'}</summary>{run.summary && <p>{run.summary}</p>}{run.errorCode && <p className="api-error">{run.errorCode}</p>}<ol className="event-log">{(run.details?.events || []).map((event, index) => <li key={event.id || index}><strong>{event.type}</strong><span>{event.summary}</span></li>)}</ol></details>)}</div></>}{running && <ol className="event-log" aria-label="当前运行事件">{liveEvents.map((event, index) => <li key={event.id || index}><strong>{event.type}</strong><span>{event.summary}</span></li>)}</ol>}</section>}
      </main>
      {authModal && <Modal titleId="auth-title" className="register-modal" onClose={() => setAuthModal(false)}><form onSubmit={submitAuth}><button type="button" className="modal-close" onClick={() => setAuthModal(false)} aria-label="关闭">×</button><span className="card-kicker">STARS ACCOUNT</span><h2 id="auth-title">{authMode === 'login' ? '登录工作区' : '注册 Stars'}</h2><p>{authMode === 'register' && !authCodeSent ? '验证真实邮箱后，开始创建你的应用。' : '登录后可以保存项目、运行记录和文件。'}</p><label>邮箱<input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} required autoComplete="email" disabled={authSubmitting || (authMode === 'register' && authCodeSent)} /></label>{authMode === 'register' && authCodeSent && <><label>邮箱验证码<div className="auth-code-row"><input inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={authCode} onChange={(event) => setAuthCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required aria-label="邮箱验证码" autoComplete="one-time-code" /><button type="button" className="outline-button auth-resend" disabled={authCooldown > 0 || authSubmitting} onClick={resendRegistrationCode}>{authCooldown > 0 ? `${authCooldown}s 后重发` : '重新发送'}</button></div></label><label>密码<input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} required minLength="8" autoComplete="new-password" disabled={authSubmitting} /></label></>}{authMode === 'login' && <label>密码<input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} required minLength="8" autoComplete="current-password" disabled={authSubmitting} /></label>}<div className="turnstile-box" ref={turnstileRef} aria-label="Cloudflare 人机校验">{!import.meta.env.VITE_TURNSTILE_SITE_KEY ? "Cloudflare 校验将在生产环境启用" : "正在加载 Cloudflare 校验…"}</div>{authError && <div className="api-error" role="alert">{authError}</div>}<button className="send-button" type="submit" disabled={authSubmitting}>{authSubmitting ? '处理中…' : authMode === 'login' ? '登录' : authCodeSent ? '验证并注册' : '发送验证码'} <Icon name="arrow" /></button><button type="button" className="auth-switch" onClick={() => switchAuthMode(authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? '还没有账号？注册' : '已有账号？登录'}</button><aside className="register-benefits"><span className="register-brand">✦ Stars</span><h3>{authMode === 'login' ? '继续你的产品旅程' : <>把想法变成<br />可运行的产品</>}</h3><ul><li>几分钟而不是几周</li><li>真实应用，不只是演示</li><li>每一步都可检查和恢复</li><li>始终拥有完整所有权</li></ul></aside></form></Modal>}
      {folderDialogOpen && <Modal titleId="folder-dialog-title" onClose={() => { if (!folderSubmitting) setFolderDialogOpen(false) }}><form onSubmit={submitFolder}><span className="card-kicker">文件夹</span><h2 id="folder-dialog-title">新建文件夹</h2><p>将项目按工作流或团队分类，文件夹只对当前账户可见。</p><label>文件夹名称<input autoFocus maxLength="80" value={folderName} onChange={event => setFolderName(event.target.value)} placeholder="例如：营销页面" required disabled={folderSubmitting} /></label>{folderError && <p className="api-error" role="alert">{folderError}</p>}<div className="confirm-actions"><button type="button" className="outline-button" disabled={folderSubmitting} onClick={() => setFolderDialogOpen(false)}>取消</button><button type="submit" className="send-button" disabled={folderSubmitting}>{folderSubmitting ? '创建中…' : '创建文件夹'}</button></div></form></Modal>}
      {folderEditDialog && <Modal titleId="folder-edit-title" onClose={() => { if (!folderSubmitting) setFolderEditDialog(null) }}><form onSubmit={submitFolderEditor}><span className="card-kicker">文件夹管理</span><h2 id="folder-edit-title">{folderEditDialog.action === 'rename' ? '重命名文件夹' : '删除文件夹'}</h2>{folderEditDialog.action === 'rename' ? <label>文件夹名称<input autoFocus maxLength="80" value={folderName} onChange={event => setFolderName(event.target.value)} required disabled={folderSubmitting} /></label> : <p>删除“{folderEditDialog.folder.name}”后，其中项目会保留并移入未分类。</p>}{folderError && <p className="api-error" role="alert">{folderError}</p>}<div className="confirm-actions"><button type="button" className="outline-button" disabled={folderSubmitting} onClick={() => setFolderEditDialog(null)}>取消</button><button type="submit" className={`send-button ${folderEditDialog.action === 'delete' ? 'danger' : ''}`} disabled={folderSubmitting}>{folderSubmitting ? '处理中…' : folderEditDialog.action === 'rename' ? '保存名称' : '确认删除'}</button></div></form></Modal>}
      {projectDialog && <Modal titleId="project-dialog-title" onClose={() => { if (!busy) setProjectDialog(null) }}><form onSubmit={submitProjectDialog}><span className="card-kicker">项目管理</span><h2 id="project-dialog-title">{projectDialog.action === 'rename' ? '重命名项目' : '删除项目'}</h2>{projectDialog.action === 'rename' ? <label>项目名称<input value={projectName} onChange={event => setProjectName(event.target.value)} maxLength="80" required autoFocus /></label> : <p>删除“{projectDialog.project.name}”？项目将从列表中移除。</p>}{dialogError && <p className="api-error" role="alert">{dialogError}</p>}<div className="confirm-actions"><button type="button" className="outline-button" disabled={busy} onClick={() => setProjectDialog(null)}>取消</button><button className="send-button" type="submit" disabled={busy}>{busy ? '处理中…' : projectDialog.action === 'rename' ? '保存名称' : '确认删除'}</button></div></form></Modal>}
      {snapshotDiff && <Modal titleId="snapshot-diff-title" className="diff-modal" onClose={() => setSnapshotDiff(null)}><h2 id="snapshot-diff-title">版本差异：{snapshotDiff.name}</h2><p>比较当前文件与此保存版本。</p><FileDiff changes={compareFiles(files.map(([path, content]) => ({ path, content })), snapshotDiff.manifest || [])} afterLabel="保存版本" /><div className="confirm-actions"><button type="button" className="outline-button" onClick={() => setSnapshotDiff(null)}>关闭差异</button></div></Modal>}
      {snapshotToRestore && <Modal titleId="restore-title" onClose={() => { if (!busy) setSnapshotToRestore(null) }}><span className="card-kicker">版本历史</span><h2 id="restore-title">恢复到“{snapshotToRestore.name}”？</h2><p>当前文件会先自动保存为保护版本，然后替换为所选快照。</p>{apiError && <div className="api-error" role="alert">{apiError}</div>}<div className="confirm-actions"><button type="button" className="outline-button" disabled={busy} onClick={() => setSnapshotToRestore(null)}>取消</button><button type="button" className="send-button" disabled={busy} onClick={confirmSnapshotRestore}>{busy ? '恢复中…' : '确认恢复'}</button></div></Modal>}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
