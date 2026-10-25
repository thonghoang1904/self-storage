// Input checks shared by every form. The API mostly limits lengths, so the screens check formats before sending.
// Two kinds of helpers:
//  - keep*: run in onChange so characters that can never be valid (digits in a name, letters in a CCCD) never appear;
//  - *Error: return the Vietnamese message to show under the field, or null when the value is valid.

// ------------------------------------------------------------------ filters (while typing)

/** Keeps digits only, up to `max` of them. Used for CCCD, phone numbers and codes typed at the gate. */
export const keepDigits = (v: string, max = 20) => v.replace(/\D/g, '').slice(0, max)
/** Letters (Vietnamese included), spaces, apostrophes and hyphens: no digits or symbols in a person's name. */
export const keepName = (v: string) => v.replace(/[^\p{L}\s'-]/gu, '').replace(/\s{2,}/g, ' ')
/** Login names: latin letters, digits, dot and underscore, no spaces or accents. */
export const keepUsername = (v: string) => v.replace(/[^a-zA-Z0-9._]/g, '')
/** Upper-case codes such as unit codes and promo codes: A–Z, 0–9 and hyphen. */
export const keepCode = (v: string) => v.toUpperCase().replace(/[^A-Z0-9-]/g, '')
/**
 * Phone numbers while typing: digits plus an optional leading "+" (for +84). Not cut at 10 digits, so a pasted
 * "84901234567" is kept whole and normalized on submit instead of silently losing its last digit.
 */
export const keepPhone = (v: string) => {
  const t = v.trim()
  return ((t.startsWith('+') ? '+' : '') + t.replace(/\D/g, '')).slice(0, 13)
}

/** "+84 901 234 567", "84901234567" or "0901.234.567" -> "0901234567": the form the database keeps. */
export function normalizePhone(value: string): string {
  const d = value.replace(/\D/g, '')
  // Vietnamese numbers dialled at home start with 0, never 84, so a leading 84 is always the country code.
  if ((value.trim().startsWith('+84') || d.startsWith('84')) && (d.length === 11 || d.length === 12)) return '0' + d.slice(2)
  return d
}

/** Mobile prefixes in use since the 2018 renumbering (Viettel, Vinaphone, MobiFone, Vietnamobile, Gmobile, Itel, Reddi). */
const MOBILE = /^0(3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-46-9])\d{7}$/

/**
 * A typing filter plus the message shown when it drops something. Characters are never removed silently:
 * `bad` spots the characters the filter rejects (separators such as spaces in a phone number are not "bad")
 * and `hint` tells the user why the key did nothing.
 */
export interface InputFilter { keep: (v: string) => string; bad: RegExp; hint: string }

export const NAME_FILTER: InputFilter = { keep: keepName, bad: /[^\p{L}\s'-]/u, hint: 'Không nhập số hoặc ký tự đặc biệt, chỉ nhập chữ cái' }
export const CITIZEN_ID_FILTER: InputFilter = { keep: (v) => keepDigits(v, 12), bad: /[^\d\s.-]/, hint: 'Số CCCD chỉ gồm chữ số' }
export const PHONE_FILTER: InputFilter = { keep: keepPhone, bad: /[^\d\s.+()-]/, hint: 'Số điện thoại chỉ gồm chữ số' }
export const USERNAME_FILTER: InputFilter = { keep: keepUsername, bad: /[^a-zA-Z0-9._]/, hint: 'Chỉ dùng chữ không dấu, số, dấu chấm hoặc gạch dưới (không khoảng trắng)' }
export const CODE_FILTER: InputFilter = { keep: keepCode, bad: /[^A-Za-z0-9-]/, hint: 'Chỉ gồm chữ, số và dấu gạch ngang' }

/** Removes the spaces, dots and dashes people type inside numbers ("0901 234 567"). */
export const digitsOnly = (v: string) => v.replace(/[\s.-]/g, '')

// ------------------------------------------------------------------ rules (on blur and on submit)

/** Two or more words, letters only, 2–100 characters. */
export function fullNameError(value: string): string | null {
  const v = value.trim()
  if (!v) return 'Vui lòng nhập họ và tên'
  if (!/^[\p{L}][\p{L}\s'-]*$/u.test(v)) return 'Họ tên chỉ gồm chữ cái và khoảng trắng'
  if (v.length < 2 || v.length > 100) return 'Họ tên phải từ 2 đến 100 ký tự'
  if (v.split(/\s+/).length < 2) return 'Vui lòng nhập đầy đủ họ và tên (ít nhất 2 từ)'
  return null
}

/**
 * CCCD: exactly 12 digits; the first 3 digits are the province code (001–096).
 * Returns the error, or null when valid (or empty and optional).
 */
export function citizenIdError(value: string, optional = false): string | null {
  const v = digitsOnly(value)
  if (!v) return optional ? null : 'Vui lòng nhập số CCCD'
  if (!/^\d+$/.test(v)) return 'Số CCCD chỉ gồm chữ số'
  if (v.length !== 12) return `Số CCCD phải gồm đúng 12 chữ số (đang có ${v.length})`
  const province = Number(v.slice(0, 3))
  if (province < 1 || province > 96) return 'Số CCCD không hợp lệ: 3 số đầu là mã tỉnh (001–096)'
  return null
}

/** Personal mobile number: 10 digits with a Vietnamese mobile prefix; +84 is accepted and converted. */
export function phoneError(value: string): string | null {
  if (!value.trim()) return 'Vui lòng nhập số điện thoại'
  if (/[^\d\s.+()-]/.test(value)) return 'Số điện thoại chỉ gồm chữ số'
  const v = normalizePhone(value)
  if (!v.startsWith('0')) return 'Số điện thoại phải bắt đầu bằng 0 hoặc +84'
  if (v.length !== 10) return `Số điện thoại di động phải gồm 10 chữ số (đang có ${v.length})`
  return MOBILE.test(v) ? null : `Đầu số ${v.slice(0, 3)} không phải đầu số di động Việt Nam`
}

/** Business hotline: a mobile number, an 11-digit landline (02x…) or a 1800/1900 number. */
export function hotlineError(value: string): string | null {
  const v = normalizePhone(value)
  if (!v) return 'Vui lòng nhập hotline'
  if (MOBILE.test(v) || /^02\d{9}$/.test(v) || /^1[89]00\d{4,6}$/.test(v)) return null
  return 'Hotline không hợp lệ: số di động 10 số, số bàn 11 số (02…) hoặc đầu số 1800/1900'
}

export function emailError(value: string): string | null {
  const v = value.trim()
  if (!v) return 'Vui lòng nhập email'
  if (v.length > 100) return 'Email tối đa 100 ký tự'
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) return 'Email không hợp lệ, vd: ten@gmail.com'
  return null
}

/** Login name: 3–50 characters, starts with a letter; letters, digits, dot and underscore. */
export function usernameError(value: string): string | null {
  const v = value.trim()
  if (!v) return 'Vui lòng nhập tên đăng nhập'
  if (v.length < 3 || v.length > 50) return 'Tên đăng nhập phải từ 3 đến 50 ký tự'
  if (!/^[a-zA-Z][a-zA-Z0-9._]*$/.test(v)) return 'Tên đăng nhập bắt đầu bằng chữ cái, chỉ gồm chữ không dấu, số, dấu chấm hoặc gạch dưới'
  return null
}

/** The rules a new password must meet; also listed live under the password field. */
export const PASSWORD_RULES: { label: string; test: (v: string) => boolean }[] = [
  { label: 'Ít nhất 8 ký tự', test: (v) => v.length >= 8 && v.length <= 100 },
  { label: 'Có chữ hoa', test: (v) => /[A-Z]/.test(v) },
  { label: 'Có chữ thường', test: (v) => /[a-z]/.test(v) },
  { label: 'Có chữ số', test: (v) => /\d/.test(v) },
  { label: 'Không có khoảng trắng', test: (v) => !/\s/.test(v) },
]

export function passwordError(value: string): string | null {
  if (!value) return 'Vui lòng nhập mật khẩu'
  const failed = PASSWORD_RULES.find((r) => !r.test(value))
  return failed ? `Mật khẩu chưa đủ mạnh: ${failed.label.toLowerCase()}` : null
}

export const confirmError = (password: string, confirm: string): string | null =>
  !confirm ? 'Vui lòng nhập lại mật khẩu' : confirm !== password ? 'Mật khẩu nhập lại không khớp' : null

/** Free text with a length range, e.g. a ticket title. `label` starts the message. */
export function textError(value: string, label: string, min: number, max: number, optional = false): string | null {
  const v = value.trim()
  if (!v) return optional ? null : `Vui lòng nhập ${label.toLowerCase()}`
  if (v.length < min) return `${label} cần ít nhất ${min} ký tự`
  if (v.length > max) return `${label} tối đa ${max} ký tự`
  return null
}

/** Relationship to the contract holder (optional): letters only, up to 50. */
export function relationshipError(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  if (!/^[\p{L}][\p{L}\s]*$/u.test(v)) return 'Quan hệ chỉ gồm chữ cái, vd: Vợ, Con, Bạn'
  return v.length > 50 ? 'Quan hệ tối đa 50 ký tự' : null
}

/** Unit codes such as A-01 or B12: letters and digits, groups separated by one hyphen. */
export function unitCodeError(value: string): string | null {
  const v = value.trim()
  if (!v) return 'Vui lòng nhập mã kho'
  if (v.length > 30) return 'Mã kho tối đa 30 ký tự'
  return /^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(v) ? null : 'Mã kho chỉ gồm chữ in hoa, số và dấu gạch ngang, vd: B-04'
}

/** "06:00 - 22:00" with the closing time after the opening time, or "24/7". */
export function operatingHoursError(value: string): string | null {
  const v = value.trim()
  if (!v) return 'Vui lòng nhập giờ hoạt động'
  if (/^24\/7/i.test(v)) return null
  const m = v.match(/^([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]|24):([0-5]\d)$/)
  if (!m) return 'Giờ hoạt động theo dạng 06:00 - 22:00, hoặc 24/7'
  return Number(m[1]) * 60 + Number(m[2]) < Number(m[3]) * 60 + Number(m[4]) ? null : 'Giờ đóng cửa phải sau giờ mở cửa'
}

/** Bank transfer reference: 6–50 letters, digits or hyphens. */
export function transactionCodeError(value: string): string | null {
  const v = value.trim()
  if (!v) return 'Vui lòng nhập mã giao dịch chuyển khoản'
  return /^[A-Za-z0-9-]{6,50}$/.test(v) ? null : 'Mã giao dịch gồm 6–50 chữ cái, số hoặc dấu gạch ngang'
}

/** Promo code (optional): 3–30 upper-case letters, digits or hyphens. */
export function promoCodeError(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  return /^[A-Z0-9-]{3,30}$/.test(v) ? null : 'Mã khuyến mãi gồm 3–30 chữ in hoa hoặc số'
}

/** Whole money amount in VND between min and max. */
export function amountError(value: number, label: string, min: number, max = 1_000_000_000): string | null {
  if (!Number.isFinite(value)) return `Vui lòng nhập ${label.toLowerCase()}`
  if (value < min) return `${label} phải từ ${min.toLocaleString('vi-VN')}đ trở lên`
  if (value > max) return `${label} tối đa ${max.toLocaleString('vi-VN')}đ`
  return null
}
