import { useEffect, useRef, useState, type FocusEvent, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, IS_DEMO } from '../api'
import { CITIZEN_ID_FILTER, citizenIdError, confirmError, emailError, fullNameError, NAME_FILTER, normalizePhone, passwordError, PHONE_FILTER, phoneError, USERNAME_FILTER, usernameError } from '../validation'
import { useAuth } from '../auth'
import { DemoBar } from '../components/layout'
import { CorridorArt, Icon, Logo } from '../components/ui'
import { homeFor } from '../types'
import { FormField, PasswordChecklist, useValidatedForm } from '../components/form'

const DEMO_ACCOUNTS = [
  { username: 'customer1', label: 'Khách hàng', note: 'Đang thuê kho B-01' },
  { username: 'staff1', label: 'Nhân viên', note: 'Cổng cơ sở Quận 7' },
  { username: 'manager1', label: 'Quản lý', note: 'Cơ sở Quận 7' },
]

/** Split screen from the Figma "user-login" frame: brand panel left, form right. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="auth-page">
      <DemoBar />
      <div className="auth-split">
        <aside className="auth-hero">
          <CorridorArt className="auth-hero-bg" />
          <div className="auth-hero-overlay" />
          <Link to="/" className="brand-link"><Logo light /></Link>
          <div className="auth-hero-copy">
            <h2>Bắt Đầu Lưu Trữ <span className="cyan">An Toàn</span> Ngay Hôm Nay</h2>
            <p>Bảo vệ tài sản cá nhân và doanh nghiệp của bạn với quy trình ra vào được xác thực bằng CCCD tại mọi cơ sở SafeKeep.</p>
            <ul className="check-list">
              <li><Icon name="check" size={12} />Nhân viên đối chiếu CCCD mỗi lượt vào kho</li>
              <li><Icon name="check" size={12} />Ủy quyền cho bất kỳ ai ngay trên tài khoản</li>
              <li><Icon name="check" size={12} />Theo dõi lịch sử ra vào minh bạch</li>
            </ul>
          </div>
          <div className="auth-hero-foot"><span>© 2026 SafeKeep Storage</span><span>Hotline: (028) 1234 5678</span></div>
        </aside>
        <main className="auth-form-wrap">
          <div className="auth-form">
            <Link to="/" className="brand-link"><Logo /></Link>
            <div className="auth-title">
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

export function PasswordInput({ value, onChange, placeholder, autoComplete, onBlur, invalid, inputRef }: {
  value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string; onBlur?: (e: FocusEvent<HTMLInputElement>) => void; invalid?: boolean
  inputRef?: (el: HTMLInputElement | null) => void
}) {
  const [show, setShow] = useState(false)
  return (
    <span className="input-wrap">
      <input type={show ? 'text' : 'password'} value={value} placeholder={placeholder} autoComplete={autoComplete} required maxLength={100}
        onChange={(e) => onChange(e.target.value)} onBlur={onBlur} aria-invalid={invalid || undefined} ref={inputRef} />
      <button type="button" className="input-icon-btn" aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onClick={() => setShow(!show)}>
        <Icon name={show ? 'eyeOff' : 'eye'} />
      </button>
    </span>
  )
}

/** Google OAuth client ID, same value as Google:ClientId in the backend appsettings. Empty: the button is hidden. */
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

interface GoogleIdApi {
  initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void
}
declare global { interface Window { google?: { accounts: { id: GoogleIdApi } } } }

let gisScript: Promise<void> | null = null
const loadGoogleScript = () => (gisScript ??= new Promise<void>((resolve, reject) => {
  const s = document.createElement('script')
  s.src = 'https://accounts.google.com/gsi/client'
  s.async = true
  s.onload = () => resolve()
  s.onerror = () => { gisScript = null; reject(new Error('Không tải được Google Sign-In, kiểm tra kết nối mạng.')) }
  document.head.appendChild(s)
}))

/**
 * "Đăng nhập với Google" (POST /api/auth/google with the ID token from Google Identity Services).
 * The backend only signs in an existing active account whose email matches the Google account; it does not create one.
 * Demo mode has no Google: the button signs in customer1 with a stand-in token.
 */
function GoogleSignIn({ busy, onToken }: { busy: boolean; onToken: (idToken: string) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const handler = useRef(onToken)
  handler.current = onToken

  useEffect(() => {
    if (IS_DEMO || !GOOGLE_CLIENT_ID) return
    let cancelled = false
    loadGoogleScript().then(() => {
      if (cancelled || !box.current || !window.google) return
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r) => handler.current(r.credential) })
      window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', width: 360, locale: 'vi' })
    }).catch((e) => setError((e as Error).message))
    return () => { cancelled = true }
  }, [])

  if (!IS_DEMO && !GOOGLE_CLIENT_ID) return null
  return (
    <div className="stack-sm">
      <div className="divider"><span>hoặc</span></div>
      {IS_DEMO ? (
        <button type="button" className="btn outline block lg google-btn" disabled={busy}
          onClick={() => onToken(`demo-google|customer1@example.com|${'x'.repeat(120)}`)}>
          <GoogleMark /> Đăng nhập với Google
        </button>
      ) : <div ref={box} className="google-btn-box" />}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      <small className="muted center">Dùng Gmail đã đăng ký tài khoản SafeKeep.{IS_DEMO && ' Bản demo đăng nhập vào customer1.'}</small>
    </div>
  )
}

const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
)

export function Login() {
  const { login, loginWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const signIn = async (u: string, p: string) => {
    setError('')
    setBusy(true)
    try {
      const user = await login(u, p)
      navigate(homeFor(user.role))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void signIn(username.trim(), password)
  }

  const signInWithGoogle = async (idToken: string) => {
    setError('')
    setBusy(true)
    try {
      const user = await loginWithGoogle(idToken)
      navigate(homeFor(user.role))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Đăng Nhập" subtitle="Chào mừng bạn trở lại!">
      <form className="stack-lg" onSubmit={submit}>
        <Field label="Tên đăng nhập">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="vd: customer1" autoComplete="username" autoFocus required />
        </Field>
        <Field label="Mật khẩu">
          <PasswordInput value={password} onChange={setPassword} placeholder="Nhập mật khẩu" autoComplete="current-password" />
        </Field>
        <Link to="/forgot-password" className="link forgot-link">Quên mật khẩu?</Link>
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
        <button className="btn primary block lg" type="submit" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng Nhập'}</button>
      </form>

      <GoogleSignIn busy={busy} onToken={(t) => void signInWithGoogle(t)} />

      {IS_DEMO && (
        <div className="demo-accounts">
          <div className="divider"><span>Tài khoản demo · mật khẩu Demo@12345</span></div>
          <div className="demo-account-grid">
            {DEMO_ACCOUNTS.map((a) => (
              <button key={a.username} type="button" className="demo-account" disabled={busy}
                onClick={() => { setUsername(a.username); setPassword('Demo@12345'); void signIn(a.username, 'Demo@12345') }}>
                <b>{a.label}</b>
                <small>{a.username} · {a.note}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="switch-link">Chưa có tài khoản? <Link to="/register">Đăng ký ngay</Link></p>
    </AuthShell>
  )
}

export function Register() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const form = useValidatedForm(
    { fullName: '', citizenId: '', phoneNumber: '', email: '', username: '', password: '', confirm: '' },
    {
      fullName: fullNameError,
      citizenId: (v) => citizenIdError(v),
      phoneNumber: phoneError,
      email: emailError,
      username: usernameError,
      password: passwordError,
      confirm: (v, all) => confirmError(all.password, v),
    },
    { fullName: NAME_FILTER, citizenId: CITIZEN_ID_FILTER, phoneNumber: PHONE_FILTER, username: USERNAME_FILTER },
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const v = form.values

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.validateAll()) return
    setBusy(true)
    try {
      await api('/api/auth/register', {
        body: {
          fullName: v.fullName.trim(), citizenId: v.citizenId, phoneNumber: normalizePhone(v.phoneNumber),
          email: v.email.trim(), username: v.username.trim(), password: v.password,
        },
      })
      await login(v.username.trim(), v.password)
      navigate('/rent')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Đăng Ký Tài Khoản" subtitle="Tạo tài khoản để đặt kho và quản lý hợp đồng của bạn.">
      <form className="stack-lg" onSubmit={submit} noValidate>
        <div className="form-grid">
          <FormField label="Họ và tên" error={form.error('fullName')}>
            <input {...form.field('fullName')} placeholder="Nguyễn Văn An" maxLength={100} autoComplete="name" autoFocus />
          </FormField>
          <FormField label="Số CCCD" error={form.error('citizenId')} hint="12 chữ số trên thẻ căn cước">
            <input {...form.field('citizenId')} placeholder="079200000123" inputMode="numeric" />
          </FormField>
          <FormField label="Số điện thoại" error={form.error('phoneNumber')}>
            <input {...form.field('phoneNumber')} placeholder="0901234567" inputMode="tel" autoComplete="tel" />
          </FormField>
          <FormField label="Email" error={form.error('email')}>
            <input {...form.field('email')} type="email" placeholder="ban@email.com" maxLength={100} autoComplete="email" />
          </FormField>
          <FormField label="Tên đăng nhập" error={form.error('username')} hint="Chữ không dấu, số, dấu chấm hoặc gạch dưới">
            <input {...form.field('username')} placeholder="vd: nguyenvanan" maxLength={50} autoComplete="username" />
          </FormField>
          <FormField label="Mật khẩu" error={form.error('password')}>
            <PasswordInput value={v.password} onChange={(x) => form.setValue('password', x)} onBlur={form.field('password').onBlur} inputRef={form.field('password').ref}
              invalid={!!form.error('password')} placeholder="Ít nhất 8 ký tự, có chữ hoa, chữ thường, số" autoComplete="new-password" />
            <PasswordChecklist value={v.password} />
          </FormField>
          <FormField label="Nhập lại mật khẩu" error={form.error('confirm')}>
            <PasswordInput value={v.confirm} onChange={(x) => form.setValue('confirm', x)} onBlur={form.field('confirm').onBlur} inputRef={form.field('confirm').ref}
              invalid={!!form.error('confirm')} placeholder="Nhập lại mật khẩu" autoComplete="new-password" />
          </FormField>
        </div>
        <p className="hint"><Icon name="idCard" size={15} /> Số CCCD sẽ được nhân viên đối chiếu với thẻ của bạn mỗi lần vào kho.</p>
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
        <button className="btn primary block lg" type="submit" disabled={busy}>{busy ? 'Đang tạo tài khoản…' : 'Đăng Ký'}</button>
      </form>
      <p className="switch-link">Đã có tài khoản? <Link to="/login">Đăng nhập</Link></p>
    </AuthShell>
  )
}
