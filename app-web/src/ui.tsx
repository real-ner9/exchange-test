import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Badge, Notice, type Tone } from './components'

// Доменные помощники экранов: статус, форматирование, опрос сервера, шапка страницы.

// ---------- статусы ----------

const TONES: Tone[] = ['gray', 'blue', 'green', 'red', 'yellow', 'orange', 'purple']

/** Цвет статуса приходит с бэкенда словом (gray, blue…). Статус всегда текстом. */
export function StatusLabel({ tone, children }: { tone: string | undefined; children: ReactNode }) {
  return <Badge tone={TONES.includes(tone as Tone) ? (tone as Tone) : 'gray'}>{children}</Badge>
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
 * id записей, у которых значение изменилось с прошлого обновления. Строка с новым статусом
 * несколько секунд подсвечена фоном — без анимации, чтобы было видно, что поменялось само.
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
        const t = setTimeout(() => setChanged(new Set()), 3000)
        prev.current = next
        return () => clearTimeout(t)
      }
    }
    prev.current = next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])
  return changed
}

// ---------- каркас страницы ----------

export function PageHead({ title, sub, back, children }: { title: ReactNode; sub?: ReactNode; back?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {back && <div className="back">{back}</div>}
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  )
}

export function ErrorNote({ text }: { text: string | null | undefined }) {
  if (!text) return null
  return (
    <Notice tone="danger" className="block">
      {text}
    </Notice>
  )
}

export function Loading() {
  return <p className="loading">Загрузка…</p>
}
