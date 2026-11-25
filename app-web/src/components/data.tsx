import { useState, type ReactNode } from 'react'
import { Button, cx } from './controls'

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
 * Обычная HTML-таблица. Сортировки и фильтры — на сервере, таблица только показывает страницу.
 * Строки из `changed` подсвечиваются фоном: так видно, что статус поменялся сам при обновлении.
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
  const cellClass = (c: Column<T>) => cx(c.num && 'num', c.nowrap && 'nowrap')
  return (
    <div className="table-wrap">
      <table className={cx('table', onRowClick && 'table-clickable')}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id} className={cellClass(c)} style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="table-empty">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const key = rowKey(r)
              return (
                <tr
                  key={key}
                  className={changed?.has(key) ? 'row-changed' : undefined}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.id} className={cellClass(c)}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

// ---------- страницы ----------

/** total известен — пишем «1–50 из 230»; неизвестен — решаем по hasNext. */
export function Pagination({
  page,
  size,
  total,
  hasNext,
  onPage,
}: {
  page: number
  size: number
  total?: number
  hasNext?: boolean
  onPage: (p: number) => void
}) {
  const next = total !== undefined ? (page + 1) * size < total : !!hasNext
  if (page === 0 && !next) return null
  const from = page * size + 1
  return (
    <nav className="pager" aria-label="Страницы">
      <span className="pager-info">
        {total !== undefined
          ? `${from.toLocaleString('ru-RU')}–${Math.min(total, (page + 1) * size).toLocaleString('ru-RU')} из ${total.toLocaleString('ru-RU')}`
          : `Страница ${page + 1}`}
      </span>
      <Button size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>
        ← Назад
      </Button>
      <Button size="sm" disabled={!next} onClick={() => onPage(page + 1)}>
        Вперёд →
      </Button>
    </nav>
  )
}

// ---------- свойства записи ----------

export type Prop = { label: string; value: ReactNode; copy?: string }

/** Список «название — значение» для карточки записи. */
export function Props({ items }: { items: Prop[] }) {
  return (
    <dl className="props">
      {items.map((i) => (
        <div key={i.label} className="props-row">
          <dt>{i.label}</dt>
          <dd>
            {i.value}
            {i.copy && <CopyButton text={i.copy} />}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="copy"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? 'скопировано' : 'копировать'}
    </button>
  )
}

// ---------- сводка цифрами ----------

export type Stat = { label: string; value: ReactNode; warn?: boolean; onClick?: () => void }

/** Короткая сводка в одну полосу. Кликабельная цифра открывает соответствующий список. */
export function Stats({ items }: { items: Stat[] }) {
  return (
    <dl className="stats">
      {items.map((i) => {
        const body = (
          <>
            <dt>{i.label}</dt>
            <dd>{i.value}</dd>
          </>
        )
        return i.onClick ? (
          <button key={i.label} type="button" className={cx('stat', 'stat-link', i.warn && 'stat-warn')} onClick={i.onClick}>
            {body}
          </button>
        ) : (
          <div key={i.label} className={cx('stat', i.warn && 'stat-warn')}>
            {body}
          </div>
        )
      })}
    </dl>
  )
}
