import { createHash, randomUUID } from 'node:crypto'

export function fileFingerprint(files) {
  return createHash('sha256').update(JSON.stringify(files.map(({ path, content }) => [path, content]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))).digest('hex')
}

const lines = content => content ? content.split(/\r\n|\r|\n/).length : 0

export function describeFileChanges(previousFiles, nextFiles, runId) {
  const previous = new Map(previousFiles.map(file => [file.path, file]))
  const next = new Map(nextFiles.map(file => [file.path, file]))
  const changes = []
  for (const file of nextFiles) {
    const before = previous.get(file.path)
    if (!before) {
      changes.push({ id: randomUUID(), runId, path: file.path, operation: 'added', contentHash: file.contentHash, diffSummary: `Added file (${lines(file.content)} lines)` })
    } else if (before.content !== file.content) {
      changes.push({ id: randomUUID(), runId, path: file.path, operation: 'modified', contentHash: file.contentHash, diffSummary: `Modified file (${lines(before.content)} → ${lines(file.content)} lines)` })
    }
  }
  for (const file of previousFiles) {
    if (!next.has(file.path)) changes.push({ id: randomUUID(), runId, path: file.path, operation: 'deleted', contentHash: file.contentHash, diffSummary: `Deleted file (${lines(file.content)} lines)` })
  }
  return changes
}
