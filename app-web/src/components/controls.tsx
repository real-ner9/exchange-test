import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'

/** Склейка классов без пустых значений. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// ---------- кнопка ----------

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary — главное действие экрана, danger — необратимое, ghost — второстепенное. */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'md' | 'sm'
  loading?: boolean
  block?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  block,
  className,
  disabled,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', 'btn-' + variant, size === 'sm' && 'btn-sm', block && 'btn-block', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
      {loading && <span className="btn-busy">…</span>}
    </button>
  )
}

// ---------- поля ввода ----------

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size' | 'prefix'> & {
  onChange?: (value: string) => void
  size?: 'md' | 'sm'
  /** Короткая подпись внутри поля слева (единицы, название параметра). */
  prefix?: ReactNode
  clearable?: boolean
}

export function TextInput({ onChange, size = 'md', prefix, clearable, className, value, ...rest }: InputProps) {
  return (
    <span className={cx('input', size === 'sm' && 'input-sm', className)}>
      {prefix && <span className="input-prefix">{prefix}</span>}
      <input value={value} onChange={(e) => onChange?.(e.target.value)} {...rest} />
      {clearable && value ? (
        <button type="button" className="input-clear" aria-label="Очистить" onClick={() => onChange?.('')}>
          ×
        </button>
      ) : null}
    </span>
  )
}

type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & {
  onChange?: (value: string) => void
}

export function TextArea({ onChange, className, rows = 3, ...rest }: TextAreaProps) {
  return <textarea className={cx('textarea', className)} rows={rows} onChange={(e) => onChange?.(e.target.value)} {...rest} />
}

export type Option = { value: string; label: string }

/** Нативный select: клавиатура и доступность — от браузера, внешний вид — свой. */
export function Select({
  id,
  value,
  onChange,
  options,
  placeholder,
  width,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  options: Option[]
  /** Пустое значение («любой»), всегда первым пунктом. */
  placeholder?: string
  width?: number
}) {
  return (
    <span className="select" style={width ? { width } : undefined}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  )
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)}>
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
      {label && <span className="switch-label">{label}</span>}
    </button>
  )
}

// ---------- переключатель вида ----------

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; count?: number }[]
  label?: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={cx('segment', o.value === value && 'segment-on')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className="segment-count">{o.count.toLocaleString('ru-RU')}</span>}
        </button>
      ))}
    </div>
  )
}

// ---------- подпись поля ----------

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  )
}
