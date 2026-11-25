import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

// ---------- значки статусов ----------

/** Значок статуса. live — процесс идёт (пульсирующая точка). */
export function Badge({ tone, children, title, live }: { tone: string; children: ReactNode; title?: string; live?: boolean }) {
  return (
    <span className={'badge badge-' + tone} title={title}>
      <span className={'badge-dot' + (live ? ' live' : '')} />
      {children}
    </span>
  )
}

// ---------- форматирование ----------

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 0) return 'через ' + fmtSpan(-s)
  if (s < 5) return 'только что'
  return fmtSpan(s) + ' назад'
}

function fmtSpan(s: number): string {
  if (s < 60) return s + ' с'
  if (s < 3600) return Math.round(s / 60) + ' мин'
  if (s < 86400) return Math.round(s / 3600) + ' ч'
  return Math.round(s / 86400) + ' дн'
}

export function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'
}

// ---------- данные ----------

/** Загрузка с периодическим обновлением: экран сам показывает свежий статус. */
export function usePolling<T>(load: () => Promise<T>, deps: unknown[], intervalMs = 3000) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load

  const reload = useCallback(async () => {
    try {
      const d = await loadRef.current()
      setData(d)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    let alive = true
    const tick = async () => {
      if (alive) await reload()
    }
    tick()
    const t = setInterval(tick, intervalMs)
    return () => {
      alive = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, reload }
}

/**
 * Возвращает id записей, у которых значение изменилось с прошлого обновления.
 * Нужен, чтобы подсветить строку, когда статус задания сменился сам (автообновление).
 */
export function useChangedIds<T>(items: T[] | undefined, id: (t: T) => string, value: (t: T) => string): Set<string> {
  const prev = useRef<Map<string, string> | null>(null)
  const [changed, setChanged] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!items) return
    const next = new Map(items.map((t) => [id(t), value(t)]))
    if (prev.current) {
      const c = new Set<string>()
      for (const [k, v] of next) {
        const before = prev.current.get(k)
        if (before !== undefined && before !== v) c.add(k)
      }
      if (c.size > 0) {
        setChanged(c)
        const t = setTimeout(() => setChanged(new Set()), 1600)
        prev.current = next
        return () => clearTimeout(t)
      }
    }
    prev.current = next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])
  return changed
}

// ---------- анимированные числа ----------

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function AnimatedNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value ?? 0)
  const from = useRef(value ?? 0)
  useEffect(() => {
    const target = value ?? 0
    const start = from.current
    if (start === target || reduceMotion()) {
      setShown(target)
      from.current = target
      return
    }
    const t0 = performance.now()
    const dur = 600
    let raf = 0
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(Math.round(start + (target - start) * eased))
      if (p < 1) raf = requestAnimationFrame(step)
      else from.current = target
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      from.current = target
    }
  }, [value])
  return <>{shown.toLocaleString('ru-RU')}</>
}

// ---------- уведомления ----------

type Toast = { id: number; text: string; tone: 'ok' | 'error' | 'info' }
const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const show = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800)
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast toast-' + t.tone}>
            <span className="toast-icon">{t.tone === 'ok' ? '✓' : t.tone === 'error' ? '!' : 'i'}</span>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

// ---------- шкала прогресса задания ----------

const STEPS = ['Создано', 'Передано во внешнюю систему', 'Принято в работу', 'Выполнено']

/**
 * Где сейчас задание на пути «создано → выполнено». Для отказов шаг, на котором остановились,
 * помечается красным; для «решается оператором» — жёлтым.
 */
export function StatusStepper({ code }: { code: string }) {
  let done = 0
  let active = -1
  let problem: { at: number; tone: 'red' | 'yellow'; label: string } | null = null
  switch (code) {
    case 'SENDING':
      done = 1
      active = 1
      break
    case 'ACCEPTED':
      done = 3
      active = 3
      break
    case 'COMPLETED':
      done = 4
      break
    case 'FAILED':
      done = 3
      problem = { at: 3, tone: 'red', label: 'Не выполнено' }
      break
    case 'REJECTED':
      done = 1
      problem = { at: 1, tone: 'yellow', label: 'Отвергнуто по содержанию' }
      break
    default: // OPERATOR
      done = 1
      problem = { at: 1, tone: 'yellow', label: 'Решается оператором' }
  }
  const last = STEPS.length - 1
  // до активного шага — наполовину (процесс идёт), до проблемного — целиком
  const reach = problem ? problem.at : active >= 0 ? active - 0.5 : done - 1
  const fill = Math.min(100, (Math.max(reach, 0) / last) * 100)
  return (
    <div className="stepper">
      <div className="stepper-track">
        <div
          className={'stepper-fill' + (problem ? ' fill-' + problem.tone : '') + (active >= 0 ? ' moving' : '')}
          style={{ width: fill + '%' }}
        />
      </div>
      {STEPS.map((s, i) => {
        const isProblem = problem?.at === i
        const cls = isProblem
          ? 'step problem-' + problem!.tone
          : i < done && i !== active
            ? 'step done'
            : i === active
              ? 'step active'
              : 'step'
        return (
          <div key={s} className={cls} style={{ ['--i' as string]: i }}>
            <div className="step-dot">{isProblem ? '!' : i < done && i !== active ? '✓' : ''}</div>
            <div className="step-label">{isProblem ? problem!.label : s}</div>
          </div>
        )
      })}
    </div>
  )
}

// ---------- прочее ----------

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="ghost icon" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null
  return <div className="note note-error">{text}</div>
}

export function Empty({ children, icon = '✦' }: { children: ReactNode; icon?: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      {children}
    </div>
  )
}

/** Скелетон таблицы — пока данные грузятся. */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton-table">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row" style={{ ['--i' as string]: i }}>
          <div className="sk sk-wide" />
          <div className="sk" />
          <div className="sk sk-pill" />
          <div className="sk" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonCard() {
  return (
    <div className="card">
      <div className="sk sk-title" />
      <div className="sk sk-block" />
      <div className="sk sk-line" />
      <div className="sk sk-line short" />
    </div>
  )
}

export function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size))
  if (pages <= 1) return null
  return (
    <div className="pager">
      <button className="ghost" disabled={page <= 0} onClick={() => onPage(page - 1)}>
        ← Назад
      </button>
      <span>
        {page + 1} из {pages}
      </span>
      <button className="ghost" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
        Вперёд →
      </button>
    </div>
  )
}

/** Строка таблицы с анимацией появления (лесенкой) и подсветкой при изменении. */
export function rowProps(i: number, flash: boolean) {
  return { className: 'row-in' + (flash ? ' flash' : ''), style: { ['--i' as string]: Math.min(i, 15) } }
}
