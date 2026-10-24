// Format checks for identity fields. The API only limits their length, so the screens check the format
// before sending: entry at the gate is verified against the citizen ID, which must be a real CCCD number.

/** Removes the spaces, dots and dashes people type inside numbers ("0901 234 567"). */
export const digitsOnly = (v: string) => v.replace(/[\s.-]/g, '')

/** CCCD has exactly 12 digits. Returns the error to show, or null when valid (or empty and optional). */
export function citizenIdError(value: string, optional = false): string | null {
  const v = digitsOnly(value)
  if (!v) return optional ? null : 'Vui lòng nhập số CCCD'
  return /^\d{12}$/.test(v) ? null : 'Số CCCD phải gồm đúng 12 chữ số'
}

/** Vietnamese mobile/landline numbers: 10 digits starting with 0. */
export function phoneError(value: string): string | null {
  const v = digitsOnly(value)
  if (!v) return 'Vui lòng nhập số điện thoại'
  return /^0\d{9}$/.test(v) ? null : 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng 0'
}
