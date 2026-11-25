import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from './controls'

// ---------- метка статуса ----------

export type Tone = 'gray' | 'blue' | 'green' | 'red' | 'yellow' | 'orange' | 'purple'

/** Статус всегда словами; цвет и точка только дублируют смысл. */
export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={'badge badge-' + tone}>
      <span className="badge-dot" aria-hidden />
      {children}
    </span>
  )
}

// ---------- сообщение на странице ----------

export function Notice({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success' | 'neutral'
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('notice', 'notice-' + tone, className)} role={tone === 'danger' ? 'alert' : undefined}>
      <div className="notice-text">
        {title && <div className="notice-title">{title}</div>}
        {children}
      </div>
      {action && <div className="notice-action">{action}</div>}
    </div>
  )
}

// ---------- диалог ----------

/**
 * Модальное окно на нативном <dialog>: фокус внутри окна, Esc и подложка — от браузера.
 * Содержимое монтируется только пока окно открыто, чтобы поля каждый раз начинались с чистого листа.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      d.querySelector<HTMLElement>('textarea, input')?.focus()
    }
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="dialog"
      onClose={() => open && onClose()}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <>
          <header className="dialog-head">
            <h2>{title}</h2>
            <button type="button" className="dialog-x" aria-label="Закрыть" onClick={onClose}>
              ×
            </button>
          </header>
          <div className="dialog-body">{children}</div>
          {footer && <footer className="dialog-foot">{footer}</footer>}
        </>
      )}
    </dialog>
  )
}

// ---------- уведомления ----------

type ToastTone = 'ok' | 'error' | 'info'
type ToastItem = { id: number; text: string; tone: ToastTone }
type Push = (text: string, tone?: ToastTone) => void

const ToastContext = createContext<Push>(() => {})
let toastSeq = 0

/** Короткие сообщения о результате действия в правом нижнем углу. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const dismiss = useCallback((id: number) => setItems((x) => x.filter((t) => t.id !== id)), [])
  const push = useCallback<Push>(
    (text, tone = 'ok') => {
      const id = ++toastSeq
      setItems((x) => [...x, { id, text, tone }])
      setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4000)
    },
    [dismiss],
  )
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={'toast toast-' + t.tone}>
            <span className="toast-mark" aria-hidden />
            <span className="toast-text">{t.text}</span>
            <button type="button" className="toast-x" aria-label="Скрыть" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): Push {
  return useContext(ToastContext)
}
