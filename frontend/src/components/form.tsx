import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent, type ReactNode } from 'react'
import { PASSWORD_RULES, type InputFilter } from '../validation'
import { Icon } from './ui'

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

/**
 * True when focus leaves a field for the form's submit button. Showing the field's error then would push the
 * button down between mouse-down and mouse-up and swallow the click; the submit check shows every error anyway.
 */
export const leavingToSubmit = (e?: FocusEvent) => (e?.relatedTarget as HTMLButtonElement | null)?.type === 'submit'

/** How long the "that character is not allowed" note stays under a field. */
const HINT_MS = 3000

/** Short-lived notes per key: `flash` shows one for HINT_MS (restarting the timer), `hide` removes one, `clear` all. */
function useFlashHints<K extends PropertyKey>() {
  const [hints, setHints] = useState<Partial<Record<K, string>>>({})
  const timers = useRef<Partial<Record<K, ReturnType<typeof setTimeout>>>>({})
  useEffect(() => () => Object.values(timers.current).forEach((t) => clearTimeout(t as ReturnType<typeof setTimeout>)), [])
  const clear = (k: K) => { clearTimeout(timers.current[k]); setHints((h) => ({ ...h, [k]: undefined })) }
  const flash = (k: K, text: string) => {
    clearTimeout(timers.current[k])
    setHints((h) => ({ ...h, [k]: text }))
    timers.current[k] = setTimeout(() => setHints((h) => ({ ...h, [k]: undefined })), HINT_MS)
  }
  return { hints, flash, hide: clear, clear: () => (Object.keys(timers.current) as K[]).forEach(clear) }
}

/**
 * Form state with per-field validation, the way most sites behave: a field shows its error once the user has
 * left it (blur), every field shows its error when the form is submitted (and the first wrong field gets the
 * focus), and errors clear as soon as the value becomes valid. `filters` run on every keystroke so impossible
 * characters never appear; when one is dropped the field says why for a few seconds instead of ignoring the key.
 */
export function useValidatedForm<T extends Record<string, string>>(
  initial: T,
  rules: Partial<Record<keyof T, (value: string, all: T) => string | null>>,
  filters: Partial<Record<keyof T, InputFilter>> = {},
) {
  const [values, setValues] = useState<T>(initial)
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({})
  const blocked = useFlashHints<keyof T>()
  const inputs = useRef<Partial<Record<keyof T, Field | null>>>({})

  const errorOf = (k: keyof T, all: T = values) => rules[k]?.(all[k], all) ?? null
  const error = (k: keyof T) => blocked.hints[k] ?? (touched[k] ? errorOf(k) : null)
  const setValue = (k: keyof T, raw: string) => {
    const f = filters[k]
    if (f && f.bad.test(raw)) blocked.flash(k, f.hint)
    // Once the field shows its real error, a clean keystroke brings that error back instead of the note.
    else if (touched[k] && blocked.hints[k]) blocked.hide(k)
    setValues((v) => ({ ...v, [k]: f ? f.keep(raw) : raw }))
  }
  /** Marks a field as left; pass the blur event so leaving for the submit button is skipped (see leavingToSubmit). */
  const touch = (k: keyof T, e?: FocusEvent) => { if (!leavingToSubmit(e)) setTouched((t) => ({ ...t, [k]: true })) }

  /** Props for an <input>/<textarea>/<select>: value, onChange, onBlur, aria-invalid and a ref for focusing. */
  const field = (k: keyof T) => ({
    value: values[k],
    onChange: (e: ChangeEvent<Field>) => setValue(k, e.target.value),
    onBlur: (e: FocusEvent) => touch(k, e),
    'aria-invalid': error(k) ? true : undefined,
    ref: (el: Field | null) => { inputs.current[k] = el },
  })

  /** Marks every field as touched, focuses the first wrong one and tells whether the whole form is valid. */
  const validateAll = () => {
    const keys = Object.keys(values) as (keyof T)[]
    setTouched(Object.fromEntries(keys.map((k) => [k, true])) as Partial<Record<keyof T, boolean>>)
    const firstBad = keys.find((k) => errorOf(k))
    if (firstBad !== undefined) inputs.current[firstBad]?.focus()
    return firstBad === undefined
  }

  const reset = (next: T = initial) => { setValues(next); setTouched({}); blocked.clear() }

  return { values, setValues, setValue, field, error, validateAll, reset, touch }
}

/**
 * For inputs outside useValidatedForm: `keep` filters a typed value and remembers the hint when characters
 * were dropped; show `hint` under the input (see FieldNote).
 */
export function useInputFilter(filter: InputFilter) {
  const { hints, flash } = useFlashHints<'hint'>()
  return {
    hint: hints.hint,
    keep: (raw: string) => { if (filter.bad.test(raw)) flash('hint', filter.hint); return filter.keep(raw) },
  }
}

/** The red line under an input. */
export function FieldNote({ text }: { text?: string | null }) {
  return text ? <small className="field-error" role="alert"><Icon name="alert" size={12} /> {text}</small> : null
}

/** A labelled field that turns red and shows its message underneath when `error` is set. */
export function FormField({ label, error, hint, children, className = '' }: {
  label: ReactNode; error?: string | null; hint?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <label className={`field ${error ? 'has-error' : ''} ${className}`}>
      <span>{label}</span>
      {children}
      {error ? <FieldNote text={error} /> : hint ? <small className="field-hint">{hint}</small> : null}
    </label>
  )
}

/** Live checklist of the password rules under a new-password field. */
export function PasswordChecklist({ value }: { value: string }) {
  if (!value) return null
  return (
    <ul className="password-rules">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(value)
        return <li key={r.label} className={ok ? 'ok' : ''}><Icon name={ok ? 'check' : 'x'} size={12} /> {r.label}</li>
      })}
    </ul>
  )
}
