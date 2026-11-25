import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Table, useTable } from '@gravity-ui/table'
import type { ColumnDef } from '@gravity-ui/table/tanstack'
import { Alert, Label, Pagination, Text, useToaster, type LabelProps } from '@gravity-ui/uikit'

// ---------- статусы ----------

// Цвета статусов приходят с бэкенда словами (gray, blue…); здесь они переводятся в темы Gravity UI.
const TONE_THEME: Record<string, LabelProps['theme']> = {
  gray: 'unknown',
  blue: 'info',
  green: 'success',
  red: 'danger',
  yellow: 'warning',
  orange: 'warning',
  purple: 'utility',
}

/** Статус всегда текстом; цвет только дублирует смысл. */
export function StatusLabel({ tone, children }: { tone: string | undefined; children: ReactNode }) {
  return (
    <Label theme={TONE_THEME[tone ?? 'gray'] ?? 'unknown'} size="xs">
      {children}
    </Label>
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

// ---------- уведомления ----------

let toastSeq = 0

/** Короткое уведомление о результате действия (Toaster из Gravity UI). */
export function useToast() {
  const toaster = useToaster()
  return useCallback(
    (text: string, tone: 'ok' | 'error' | 'info' = 'ok') =>
      toaster.add({
        name: 'toast-' + ++toastSeq,
        content: text,
        theme: tone === 'ok' ? 'success' : tone === 'error' ? 'danger' : 'info',
        autoHiding: tone === 'error' ? 8000 : 4000,
      }),
    [toaster],
  )
}

// ---------- таблица ----------

export type Column<T> = {
  id: string
  header: string
  cell: (row: T) => ReactNode
  /** Числа выравниваются вправо и пишутся цифрами одинаковой ширины. */
  num?: boolean
  width?: number
  nowrap?: boolean
}

/**
 * Обёртка над @gravity-ui/table: колонки описываются коротко, а TanStack-часть (useTable)
 * спрятана здесь. Сортировки и фильтры — на сервере, таблица только показывает страницу.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  changed,
  empty = 'Нет записей',
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  changed?: Set<string>
  empty?: ReactNode
}) {
  const defs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.header,
        cell: ({ row }) => c.cell(row.original),
        size: c.width,
        meta: c,
      })),
    [columns],
  )
  const table = useTable({ columns: defs, data: rows, getRowId: (r) => rowKey(r) })
  const cls = (meta: unknown) => {
    const c = meta as Column<T> | undefined
    return [c?.num ? 'cell-num' : '', c?.nowrap ? 'cell-nowrap' : ''].join(' ').trim()
  }
  // Колонка без ширины забирает оставшееся место (TanStack иначе подставил бы 150px).
  const width = (meta: unknown) => ({ style: { width: (meta as Column<T> | undefined)?.width ?? 'auto' } })
  return (
    <div className="table-wrap">
      <Table
        table={table}
        size="s"
        verticalAlign="top"
        stickyHeader
        className={'data-table' + (onRowClick ? ' data-table-clickable' : '')}
        headerCellClassName={(h) => cls(h?.column.columnDef.meta)}
        cellClassName={(cell) => cls(cell?.column.columnDef.meta)}
        headerCellAttributes={(h) => width(h?.column.columnDef.meta)}
        cellAttributes={(cell) => width(cell?.column.columnDef.meta)}
        rowClassName={(row) => (row && changed?.has(row.id) ? 'row-changed' : '')}
        onRowClick={onRowClick ? (row) => onRowClick(row.original) : undefined}
        emptyContent={<div className="table-empty">{empty}</div>}
      />
    </div>
  )
}

// ---------- прочее ----------

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <Text as="h1" variant="header-1">
          {title}
        </Text>
        {sub && (
          <Text as="p" color="secondary" className="page-sub">
            {sub}
          </Text>
        )}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  )
}

/** Подпись над полем ввода — одинаково для всех форм. */
export function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <Text as="label" htmlFor={id} color="secondary" className="field-label">
        {label}
      </Text>
      {children}
    </div>
  )
}

export function ErrorNote({ text }: { text: string | null | undefined }) {
  if (!text) return null
  return <Alert theme="danger" view="outlined" message={text} className="block" />
}

export function Loading() {
  return (
    <Text color="secondary" className="block">
      Загрузка…
    </Text>
  )
}

export function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  if (total <= size) return null
  return (
    <div className="pager">
      <Pagination page={page + 1} pageSize={size} total={total} compact onUpdate={(p) => onPage(p - 1)} />
    </div>
  )
}

/** Короткая сводка цифрами — строкой, без карточек. */
export function Counters({ items }: { items: { label: string; value: ReactNode; warn?: boolean; onClick?: () => void }[] }) {
  return (
    <dl className="counters">
      {items.map((i) => (
        <div key={i.label} className={'counter' + (i.warn ? ' counter-warn' : '') + (i.onClick ? ' counter-link' : '')}>
          <dt>{i.label}</dt>
          <dd>{i.onClick ? <button type="button" onClick={i.onClick}>{i.value}</button> : i.value}</dd>
        </div>
      ))}
    </dl>
  )
}
