/**
 * Shared input checks, matching the backend DTO limits (Dtos.cs / AccessDtos.cs) plus Vietnamese formats the
 * backend does not check itself. Each function returns an error message, or '' when the value is valid.
 */

/** Removes spaces, dots and dashes people type inside numbers ("0909 123 456", "079.200.000.123"). */
export const digitsOnly = (s: string) => s.replace(/[\s.\-]/g, '')

/** CCCD: 12 digits (old 9-digit CMND still accepted by some records). */
export function checkCitizenId(value: string, label = 'Số CCCD'): string {
  const v = digitsOnly(value)
  if (!v) return `Vui lòng nhập ${label.toLowerCase()}`
  if (!/^\d+$/.test(v)) return `${label} chỉ gồm chữ số`
  if (v.length !== 12 && v.length !== 9) return `${label} phải có 12 chữ số (CMND cũ 9 chữ số)`
  return ''
}

/** Vietnamese phone: 10 digits starting with 0, or +84 followed by 9 digits. */
export function checkPhone(value: string, label = 'Số điện thoại', optional = false): string {
  const v = digitsOnly(value)
  if (!v) return optional ? '' : `Vui lòng nhập ${label.toLowerCase()}`
  if (!/^(0\d{9}|\+84\d{9})$/.test(v)) return `${label} không hợp lệ (10 chữ số, bắt đầu bằng 0)`
  return ''
}

export function checkEmail(value: string): string {
  const v = value.trim()
  if (!v) return 'Vui lòng nhập email'
  if (v.length > 100) return 'Email tối đa 100 ký tự'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'Email không hợp lệ'
  return ''
}

export function checkUsername(value: string): string {
  const v = value.trim()
  if (v.length < 3 || v.length > 50) return 'Tên đăng nhập từ 3 đến 50 ký tự'
  if (!/^[A-Za-z0-9._-]+$/.test(v)) return 'Tên đăng nhập chỉ gồm chữ không dấu, số và . _ -'
  return ''
}

export function checkPassword(value: string): string {
  if (value.length < 8) return 'Mật khẩu phải có ít nhất 8 ký tự'
  if (value.length > 100) return 'Mật khẩu tối đa 100 ký tự'
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Mật khẩu cần có cả chữ và số'
  return ''
}

/** Required text with a maximum length (after trimming). */
export function checkText(value: string, label: string, max: number, optional = false, min = 1): string {
  const v = value.trim()
  if (!v) return optional ? '' : `Vui lòng nhập ${label.toLowerCase()}`
  if (v.length < min) return `${label} cần ít nhất ${min} ký tự`
  if (v.length > max) return `${label} tối đa ${max} ký tự`
  return ''
}

/** Whole VND amount within [min, max]. */
export function checkMoney(value: number | string, label: string, min = 1, max = 9_999_999_999_999): string {
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[.,\s]/g, ''))
  if (!Number.isFinite(n) || String(value).trim() === '') return `Vui lòng nhập ${label.toLowerCase()}`
  if (!Number.isInteger(n)) return `${label} phải là số tiền nguyên (đồng)`
  if (n < min) return `${label} phải từ ${min.toLocaleString('vi-VN')}đ trở lên`
  if (n > max) return `${label} quá lớn`
  return ''
}

/** Integer within [min, max]. */
export function checkInt(value: number | string, label: string, min: number, max: number): string {
  const n = Number(value)
  if (String(value).trim() === '' || !Number.isInteger(n)) return `${label} phải là số nguyên`
  if (n < min || n > max) return `${label} phải từ ${min} đến ${max}`
  return ''
}

/** First non-empty message, for chaining several checks. */
export const firstError = (...messages: string[]) => messages.find(Boolean) ?? ''

/** Today's date (yyyy-mm-dd) on the user's clock, not UTC: toISOString() gives yesterday before 07:00 in Vietnam. */
export function localToday(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
