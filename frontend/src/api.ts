const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5080'
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

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })

  if (!res.ok) {
    // The API answers errors as ProblemDetails: { title, status, errors? }
    let message = `Lỗi ${res.status}`
    try {
      const p = await res.json()
      message = p.errors ? Object.values(p.errors).flat().join(' ') : (p.title ?? message)
    } catch {
      /* empty body */
    }
    if (res.status === 401 && token) tokenStore.clear()
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const fmtMoney = (n: number) => n.toLocaleString('vi-VN') + 'đ'
// "2026-10-13" (DateOnly) must be read as a local date, not UTC midnight.
export const fmtDate = (s: string) =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
export const fmtTime = (s: string) =>
  new Date(s).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
