// Тонкий клиент API. Сессия — cookie, поэтому credentials: 'same-origin'.

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Сервер не ответил. Проверьте соединение и повторите.')
  }
  const text = await res.text()
  const data = text ? safeJson(text) : null
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/login')) onUnauthorized()
    const d = (data ?? {}) as { error?: string; message?: string }
    throw new ApiError(res.status, d.error ?? 'HTTP_' + res.status, d.message ?? 'Ошибка ' + res.status)
  }
  return data as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body: unknown = {}) => request<T>('POST', path, body),
}

// ---------- типы ----------

export type User = { id: string; login: string; displayName: string; role: 'INITIATOR' | 'OPERATOR' }

export type UserStatus = { code: string; label: string; color: string; needsAction: boolean; hint: string }

export type Payload = { title: string; amount: number | null; comment: string | null }

export type InitiatorTask = {
  id: string
  title: string
  payload: Payload
  status: UserStatus
  createdAt: string
  updatedAt: string
  completedAt: string | null
  problem?: string | null
  history?: { at: string; label: string; color: string }[]
}

export type Page<T> = { items: T[]; total: number; page: number; size: number }

export type OperatorTask = {
  id: string
  title: string
  payload: Payload
  initiator: string
  status: string
  userStatus: string
  attentionReason: string | null
  operationKey: string
  clientRequestId: string
  externalStatus: string | null
  externalVersion: number
  attemptsCount: number
  firstAttemptAt: string | null
  nextAttemptAt: string | null
  lastError: string | null
  closedReason: string | null
  confirmedAfterManualClose: boolean
  completedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
  canRetry: boolean
  canClose: boolean
}

export type Attempt = {
  attemptId: string
  trigger: string
  startedAt: string
  finishedAt: string | null
  outcome: string | null
  httpStatus: number | null
  error: string | null
  rawResponse: string | null
}

export type InboxResult = {
  resultId: string
  version: number
  outcome: string
  executedAt: string | null
  receivedAt: string
  disposition: string
}

export type TaskEvent = {
  id: number
  taskId: string
  taskTitle: string
  at: string
  kind: string
  fromStatus: string | null
  toStatus: string | null
  reason: string | null
  actor: string
  details: Record<string, unknown> | null
}

export type Discrepancy = {
  id: number
  runId: number
  taskId: string | null
  taskTitle: string | null
  operationKey: string
  ourStatus: string | null
  theirStatus: string | null
  kind: string
  foundAt: string
  resolvedAt: string | null
  resolution: string | null
  resolvedBy: string | null
}

export type OperatorTaskDetail = OperatorTask & {
  attempts: Attempt[]
  results: InboxResult[]
  events: TaskEvent[]
  discrepancies: Pick<Discrepancy, 'id' | 'kind' | 'ourStatus' | 'theirStatus' | 'resolvedAt' | 'resolution'>[]
}

export type ReconcileRun = {
  id: number
  startedAt: string
  finishedAt: string | null
  checked: number
  mismatches: number
  error: string | null
  startedBy: string
}

export type Fault = { mode: string; enabled: boolean; params: Record<string, unknown> }
