import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, IS_DEMO } from '../api'
import { Icon } from '../components/ui'
import { AuthShell, Field, PasswordInput } from './Login'

/**
 * Forgot password (POST /api/auth/forgot-password, /api/auth/reset-password):
 * 1. enter the registered email; the backend emails a single-use code valid for 30 minutes,
 * 2. paste that code and choose a new password.
 * The demo build has no email, so the mock backend returns the code and it is shown on screen.
 */
export default function ForgotPassword() {
  const navigate = useNavigate()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [demoToken, setDemoToken] = useState('')
  const [notice, setNotice] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const send = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const res = await api<{ message: string; demoToken?: string }>('/api/auth/forgot-password', { body: { email: email.trim() } })
      setNotice(res.message)
      setDemoToken(res.demoToken ?? '')
      setStep(2)
    })
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8) return setError('Mật khẩu mới cần ít nhất 8 ký tự')
    if (password !== confirm) return setError('Mật khẩu nhập lại không khớp')
    void run(async () => {
      await api('/api/auth/reset-password', { body: { token: token.trim(), newPassword: password } })
      setStep(3)
    })
  }

  const titles = {
    1: ['Quên Mật Khẩu', 'Nhập email bạn đã đăng ký, chúng tôi sẽ gửi mã đặt lại mật khẩu.'],
    2: ['Đặt Mật Khẩu Mới', 'Nhập mã trong email và tạo mật khẩu mới cho tài khoản.'],
    3: ['Đổi Mật Khẩu Thành Công', 'Bạn có thể đăng nhập bằng mật khẩu mới.'],
  } as const

  return (
    <AuthShell title={titles[step][0]} subtitle={titles[step][1]}>
      <ol className="mini-steps">
        {['Nhập email', 'Mã & mật khẩu mới', 'Hoàn tất'].map((label, i) => (
          <li key={label} className={i + 1 < step ? 'done' : i + 1 === step ? 'active' : ''}>
            <span>{i + 1 < step ? <Icon name="check" size={12} /> : i + 1}</span>{label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <form className="stack-lg" onSubmit={send}>
          <Field label="Email đã đăng ký">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ban@email.com" autoComplete="email" autoFocus required />
          </Field>
          <p className="hint"><Icon name="mail" size={15} /> Mã có hiệu lực 30 phút và chỉ dùng được một lần.</p>
          {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
          <button className="btn primary block lg" type="submit" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi Mã Đặt Lại'}</button>
        </form>
      )}

      {step === 2 && (
        <form className="stack-lg" onSubmit={save}>
          {notice && <p className="alert ok"><Icon name="mail" size={16} />{notice}</p>}
          {IS_DEMO && demoToken && (
            <p className="hint"><Icon name="key" size={15} /> Bản demo không gửi email thật. Mã của bạn: <b>{demoToken}</b>
              <button type="button" className="link-btn" onClick={() => setToken(demoToken)}>Dán mã</button></p>
          )}
          <Field label="Mã trong email">
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Dán mã đặt lại mật khẩu" autoComplete="one-time-code" required />
          </Field>
          <Field label="Mật khẩu mới">
            <PasswordInput value={password} onChange={setPassword} placeholder="Ít nhất 8 ký tự" autoComplete="new-password" />
          </Field>
          <Field label="Nhập lại mật khẩu mới">
            <PasswordInput value={confirm} onChange={setConfirm} placeholder="Nhập lại mật khẩu" autoComplete="new-password" />
          </Field>
          {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
          <button className="btn primary block lg" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu Mật Khẩu Mới'}</button>
          <button className="btn ghost block" type="button" onClick={() => { setStep(1); setError('') }}>Gửi lại mã</button>
        </form>
      )}

      {step === 3 && (
        <div className="stack-lg">
          <p className="alert ok"><Icon name="check" size={16} />Mật khẩu đã được cập nhật.</p>
          <button className="btn primary block lg" onClick={() => navigate('/login')}>Đăng Nhập</button>
        </div>
      )}

      <p className="switch-link">Nhớ mật khẩu rồi? <Link to="/login">Đăng nhập</Link></p>
    </AuthShell>
  )
}
