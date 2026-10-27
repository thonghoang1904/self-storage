import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './ui'

type Opt = { value: string; label: string; disabled: boolean }

/** Reads the <option> children (also inside arrays from .map and fragments). */
function readOptions(children: ReactNode, out: Opt[] = []): Opt[] {
  Children.forEach(children, (ch) => {
    if (!isValidElement(ch)) return
    const props = ch.props as { value?: string | number; children?: ReactNode; disabled?: boolean }
    if (ch.type === Fragment) { readOptions(props.children, out); return }
    if (ch.type !== 'option') return
    const label = Children.toArray(props.children).join('')
    out.push({ value: props.value === undefined ? label : String(props.value), label, disabled: !!props.disabled })
  })
  return out
}

/**
 * Drop-in for <select>: same value / onChange(e.target.value) / <option> children, but the list is drawn by the
 * app (rounded panel, check on the chosen item) instead of the browser's grey native list.
 */
export function Select({ value, onChange, children, disabled, required: _required, id, className, onBlur, ...aria }: {
  value: string | number | null | undefined
  onChange?: (e: { target: { value: string } }) => void
  children: ReactNode
  disabled?: boolean
  /** Kept for drop-in use; an empty value is caught by the form's own validation. */
  required?: boolean
  id?: string
  className?: string
  onBlur?: () => void
  'aria-label'?: string
  'aria-invalid'?: boolean
}) {
  const options = readOptions(children)
  const current = String(value ?? '')
  const selectedIndex = options.findIndex((o) => o.value === current)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean; maxH: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLUListElement>(null)
  const listId = useId()

  const place = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const below = window.innerHeight - r.bottom - 8
    const above = r.top - 8
    const want = Math.min(300, options.length * 40 + 12)
    const up = below < want && above > below
    setPos({ left: r.left, top: up ? r.top - 6 : r.bottom + 6, width: r.width, up, maxH: Math.max(120, Math.min(300, up ? above : below)) })
  }

  const show = () => {
    if (disabled) return
    place(); setActive(selectedIndex >= 0 ? selectedIndex : options.findIndex((o) => !o.disabled)); setOpen(true)
  }
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus() }
  const choose = (i: number) => {
    const o = options[i]
    if (!o || o.disabled) return
    if (o.value !== current) onChange?.({ target: { value: o.value } })
    close()
  }

  useLayoutEffect(() => { if (open) place() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => {
      const t = e.target as Node
      if (!btn.current?.contains(t) && !menu.current?.contains(t)) close(false)
    }
    // The list is fixed to the screen: follow the button when the page scrolls.
    const onScroll = (e: Event) => { if (!menu.current?.contains(e.target as Node)) place() }
    document.addEventListener('mousedown', outside)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', place)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Scroll only the list (scrollIntoView could scroll the page, which closes the list).
    const m = menu.current
    const el = open && active >= 0 ? m?.querySelector<HTMLElement>(`[data-i="${active}"]`) : null
    if (!m || !el) return
    if (el.offsetTop < m.scrollTop) m.scrollTop = el.offsetTop - 6
    else if (el.offsetTop + el.offsetHeight > m.scrollTop + m.clientHeight) m.scrollTop = el.offsetTop + el.offsetHeight - m.clientHeight + 6
  }, [open, active])

  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i].disabled) return i
    return from
  }
  const onKey = (e: KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => step(a, 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => step(a, -1)) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(step(-1, 1)) }
    else if (e.key === 'End') { e.preventDefault(); setActive(step(options.length, -1)) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active) }
    else if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); close(e.key === 'Escape') }
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase()
      const n = options.length
      for (let j = 1; j <= n; j++) {
        const i = (active + j) % n
        if (!options[i].disabled && options[i].label.trim().toLowerCase().startsWith(k)) { setActive(i); break }
      }
    }
  }

  return (
    <>
      <button
        ref={btn} type="button" id={id} disabled={disabled}
        className={`select-btn ${open ? 'open' : ''} ${className ?? ''}`}
        role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={aria['aria-label']} aria-invalid={aria['aria-invalid']}
        onClick={() => (open ? close() : show())} onKeyDown={onKey} onBlur={() => { if (!open) onBlur?.() }}
      >
        <span className="select-value">{selectedIndex >= 0 ? options[selectedIndex].label : ''}</span>
      </button>
      {open && pos && createPortal(
        <ul
          ref={menu} id={listId} role="listbox" className={`select-menu ${pos.up ? 'up' : ''}`}
          style={{ left: pos.left, top: pos.top, minWidth: pos.width, maxHeight: pos.maxH }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((o, i) => (
            <li
              key={`${o.value}-${i}`} id={`${listId}-${i}`} data-i={i} data-value={o.value} role="option"
              aria-selected={i === selectedIndex} aria-disabled={o.disabled || undefined}
              className={`select-option ${i === active ? 'active' : ''} ${i === selectedIndex ? 'selected' : ''} ${o.disabled ? 'disabled' : ''}`}
              onMouseEnter={() => !o.disabled && setActive(i)} onClick={() => choose(i)}
            >
              <span>{o.label}</span>
              {i === selectedIndex && <Icon name="check" size={16} />}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  )
}
