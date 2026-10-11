const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5080'
const TOKEN_KEY = 'ss_token'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

interface RequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers }
  const token = tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
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
    if (res.status === 401 && token && !path.startsWith('/api/kiosk')) tokenStore.clear()
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/** Calls made by the gate kiosk, authenticated with the device key instead of a user login. */
export function kioskApi<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, { body, headers: { 'X-Kiosk-Key': import.meta.env.VITE_KIOSK_KEY ?? '' } })
}

export const fmtMoney = (n: number) => n.toLocaleString('vi-VN') + ' ₫'
export const fmtDate = (s: string) => new Date(s).toLocaleDateString('vi-VN')
export const fmtTime = (s: string) =>
  new Date(s).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
