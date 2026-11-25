import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

export function Badge({ tone, children, title }: { tone: string; children: ReactNode; title?: string }) {
  return (
    <span className={'badge badge-' + tone} title={title}>
      {children}
    </span>
  )
}

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

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="ghost" onClick={onClose} aria-label="Закрыть">
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

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
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
