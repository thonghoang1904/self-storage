// Empty in development: requests go to /api on the Vite dev server, which proxies them to the
// backend (see vite.config.ts), so CORS and port mix-ups cannot block the browser.
// Set VITE_API_URL to the backend address for a production build.
const API_URL = import.meta.env.VITE_API_URL ?? ''

const BACKEND_DOWN = import.meta.env.DEV
  ? 'Không kết nối được tới backend. Hãy kiểm tra backend đang chạy (cửa sổ dotnet run, mở được http://localhost:5080/swagger), rồi thử lại.'
  : 'Không kết nối được tới máy chủ. Vui lòng thử lại sau.'
const TOKEN_KEY = 'ss_token'

/** VITE_MOCK=true: run against the in-browser demo backend (src/mock/server.ts) instead of the real API. */
export const IS_DEMO = import.meta.env.VITE_MOCK === 'true'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// localStorage can be unavailable (private mode, sandboxed previews); keep a copy in memory too.
let memoryToken: string | null = null
export const tokenStore = {
  get: () => {
    try { return localStorage.getItem(TOKEN_KEY) ?? memoryToken } catch { return memoryToken }
  },
  set: (t: string) => {
    memoryToken = t
    try { localStorage.setItem(TOKEN_KEY, t) } catch { /* memory only */ }
  },
  clear: () => {
    memoryToken = null
    try { localStorage.removeItem(TOKEN_KEY) } catch { /* memory only */ }
  },
}

interface RequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = tokenStore.get()
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET')

  if (IS_DEMO) {
    const { mockRequest, MockHttpError } = await import('./mock/server')
    try {
      return (await mockRequest(method, path, opts.body, token)) as T
    } catch (e) {
      if (e instanceof MockHttpError) {
        if (e.status === 401 && token) tokenStore.clear()
        throw new ApiError(e.status, e.message)
      }
      throw e
    }
  }

  const headers: Record<string, string> = { ...opts.headers }
  if (token) headers.Authorization = `Bearer ${token}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    // Network error or blocked by CORS: the browser never got an answer.
    throw new ApiError(0, BACKEND_DOWN)
  }

  if (!res.ok) {
    // The API answers errors as ProblemDetails: { title, status, errors? }
    let message = `Lỗi ${res.status}`
    let isProblem = false
    try {
      const p = await res.json()
      isProblem = true
      message = p.errors ? (Object.values(p.errors).flat() as string[]).map(toVietnamese).join(' ') : (p.title ?? message)
    } catch {
      /* empty or non-JSON body */
    }
    // The Vite dev proxy answers 5xx without a JSON body when the backend is not running.
    if (!isProblem && res.status >= 500) message = BACKEND_DOWN
    if (res.status === 401 && token) tokenStore.clear()
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/** GET a file (CSV export) with the signed-in user's token and hand it to the browser as a download. */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  let blob: Blob
  if (IS_DEMO) {
    const { mockRequest, MockHttpError } = await import('./mock/server')
    try {
      blob = new Blob([String(await mockRequest('GET', path, undefined, tokenStore.get()))], { type: 'text/csv;charset=utf-8' })
    } catch (e) {
      if (e instanceof MockHttpError) throw new ApiError(e.status, e.message)
      throw e
    }
  } else {
    const token = tokenStore.get()
    let res: Response
    try {
      res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    } catch {
      throw new ApiError(0, BACKEND_DOWN)
    }
    if (!res.ok) {
      let message = `Lỗi ${res.status}`
      try { const p = await res.json(); message = p.title ?? message } catch { /* not JSON */ }
      throw new ApiError(res.status, message)
    }
    blob = await res.blob()
  }
  // A CSV from the server is comma-separated; rewrite it so Excel splits it into columns on any machine.
  if (fileName.toLowerCase().endsWith('.csv')) blob = tableFile(parseCsv(await blob.text()))
  saveBlob(blob, fileName)
}

function saveBlob(blob: Blob, fileName: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Reads comma-separated text (quoted fields, "" for a quote, optional BOM) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

/**
 * An export file Excel opens with one value per cell whatever the computer's list separator is (a Vietnamese
 * Windows uses ";", so a comma CSV lands in one column): tab-separated UTF-16 text with a byte-order mark.
 * Numbers with a leading 0 (phone numbers, codes) are kept as text so Excel does not drop the 0.
 */
export function tableFile(rows: (string | number | null | undefined)[][]): Blob {
  const cell = (v: string | number | null | undefined) => {
    const s = (v == null ? '' : String(v)).replace(/[\t\r\n]+/g, ' ')
    return /^0\d+$/.test(s) ? `="${s}"` : s
  }
  const text = rows.map((r) => r.map(cell).join('\t')).join('\r\n')
  const bytes = new Uint8Array(2 + text.length * 2)
  bytes[0] = 0xff; bytes[1] = 0xfe
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes[2 + i * 2] = code & 0xff
    bytes[3 + i * 2] = code >> 8
  }
  return new Blob([bytes], { type: 'text/csv;charset=utf-16le' })
}

/** Builds the export file from rows (header row first) and hands it to the browser as a download. */
export function saveTable(fileName: string, rows: (string | number | null | undefined)[][]) {
  saveBlob(tableFile(rows), fileName)
}

// ASP.NET Core writes model validation errors in English ("The FullName field is required.").
// Translate the common ones so every form shows Vietnamese messages.
const FIELD_LABELS: Record<string, string> = {
  Username: 'Tên đăng nhập', Password: 'Mật khẩu', NewPassword: 'Mật khẩu mới', FullName: 'Họ tên', Email: 'Email',
  PhoneNumber: 'Số điện thoại', CitizenId: 'Số CCCD', Title: 'Tiêu đề', Description: 'Mô tả', Relationship: 'Quan hệ',
  FacilityName: 'Tên cơ sở', Address: 'Địa chỉ', City: 'Thành phố', District: 'Quận/Huyện', Hotline: 'Hotline',
  OperatingHours: 'Giờ hoạt động', UnitCode: 'Mã kho', Notes: 'Ghi chú', Token: 'Mã xác minh',
}
const label = (field: string) => FIELD_LABELS[field] ?? field

function toVietnamese(msg: string): string {
  let m
  if ((m = msg.match(/^The (\w+) field is required\.$/))) { const l = label(m[1]); return `Vui lòng nhập ${l[0].toLowerCase()}${l.slice(1)}.` }
  if ((m = msg.match(/^The field (\w+) must be a string with a minimum length of (\d+) and a maximum length of (\d+)\.$/)))
    return `${label(m[1])} phải từ ${m[2]} đến ${m[3]} ký tự.`
  if ((m = msg.match(/^The field (\w+) must be a string(?: or array type)? with a maximum length of '?(\d+)'?\.$/)))
    return `${label(m[1])} tối đa ${m[2]} ký tự.`
  if ((m = msg.match(/^The (\w+) field is not a valid e-mail address\.$/))) return 'Email không hợp lệ.'
  if ((m = msg.match(/^The field (\w+) must be between (.+) and (.+)\.$/))) return `${label(m[1])} phải từ ${m[2]} đến ${m[3]}.`
  if (/^The JSON value could not be converted|^'.*' is an invalid/.test(msg)) return 'Dữ liệu gửi lên không đúng định dạng.'
  return msg
}

export const fmtMoney =(n: number) => n.toLocaleString('vi-VN') + 'đ'
// "2026-10-13" (DateOnly) must be read as a local date, not UTC midnight.
export const fmtDate = (s: string) =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
export const fmtTime = (s: string) =>
  new Date(s).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })

/** Staff billing page pre-filtered by a contract, reservation or invoice code (no copying codes between pages). */
export const billingLink = (code: string) => `/staff-billing?q=${encodeURIComponent(code)}`
