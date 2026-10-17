import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, IS_DEMO } from '../api'
import { useAuth } from '../auth'
import { DemoBar } from '../components/layout'
import { CorridorArt, Icon, Logo } from '../components/ui'
import { homeFor } from '../types'

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
              <li><Icon name="check" size={12} />Ủy quyền cho người nhà ngay trên tài khoản</li>
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

export function PasswordInput({ value, onChange, placeholder, autoComplete }: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="input-wrap">
      <input type={show ? 'text' : 'password'} value={value} placeholder={placeholder} autoComplete={autoComplete} required
        onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="input-icon-btn" aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onClick={() => setShow(!show)}>
        <Icon name={show ? 'eyeOff' : 'eye'} />
      </button>
    </span>
  )
}

export function Login() {
  const { login } = useAuth()
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
    void signIn(username, password)
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
  const [form, setForm] = useState({ fullName: '', citizenId: '', phoneNumber: '', email: '', username: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api('/api/auth/register', { body: form })
      await login(form.username, form.password)
      navigate('/rent')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Đăng Ký Tài Khoản" subtitle="Tạo tài khoản để đặt kho và quản lý hợp đồng của bạn.">
      <form className="stack-lg" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Họ và tên"><input value={form.fullName} onChange={set('fullName')} placeholder="Nguyễn Văn An" required autoFocus /></Field>
          <Field label="Số CCCD"><input value={form.citizenId} onChange={set('citizenId')} placeholder="12 chữ số" inputMode="numeric" required /></Field>
          <Field label="Số điện thoại"><input value={form.phoneNumber} onChange={set('phoneNumber')} placeholder="09xx xxx xxx" inputMode="tel" required /></Field>
          <Field label="Email"><input type="email" value={form.email} onChange={set('email')} placeholder="ban@email.com" required /></Field>
          <Field label="Tên đăng nhập"><input value={form.username} onChange={set('username')} placeholder="Ít nhất 3 ký tự" autoComplete="username" required /></Field>
          <Field label="Mật khẩu">
            <PasswordInput value={form.password} onChange={(v) => setForm({ ...form, password: v })} placeholder="Ít nhất 8 ký tự" autoComplete="new-password" />
          </Field>
        </div>
        <p className="hint"><Icon name="idCard" size={15} /> Số CCCD sẽ được nhân viên đối chiếu với thẻ của bạn mỗi lần vào kho.</p>
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
        <button className="btn primary block lg" type="submit" disabled={busy}>{busy ? 'Đang tạo tài khoản…' : 'Đăng Ký'}</button>
      </form>
      <p className="switch-link">Đã có tài khoản? <Link to="/login">Đăng nhập</Link></p>
    </AuthShell>
  )
}
