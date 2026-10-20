import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, IS_DEMO } from '../api'
import { Icon } from '../components/ui'
import { AuthShell, Field, PasswordInput } from './Login'

/**
 * Forgot / reset password, Figma "forgot-password" (45:1230) on the same split layout as login.
 * 1. Email → POST /api/auth/forgot-password: the backend emails a single-use code, valid 30 minutes.
 * 2. Code + new password → POST /api/auth/reset-password.
 * The demo build sends no email, so its mock backend returns the code and it is shown on screen.
 */
export default function ForgotPassword() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'email' | 'reset' | 'done'>('email')
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
      setStep('reset')
    })
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8) return setError('Mật khẩu mới cần ít nhất 8 ký tự')
    if (password !== confirm) return setError('Mật khẩu nhập lại không khớp')
    void run(async () => {
      await api('/api/auth/reset-password', { body: { token: token.trim(), newPassword: password } })
      setStep('done')
    })
  }

  const back = <p className="switch-link">Đã nhớ mật khẩu? <Link to="/login">Quay lại đăng nhập</Link></p>

  if (step === 'email') {
    return (
      <AuthShell title="Quên mật khẩu" subtitle="Vui lòng nhập email để đặt lại mật khẩu">
        <form className="stack-lg" onSubmit={send}>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@safekeep.com.vn" autoComplete="email" autoFocus required />
          </Field>
          {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
          <button className="btn primary block lg upper" type="submit" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi mã xác minh'}</button>
        </form>
        {back}
      </AuthShell>
    )
  }

  if (step === 'reset') {
    return (
      <AuthShell title="Đặt mật khẩu mới" subtitle={`Nhập mã đã gửi tới ${email} và chọn mật khẩu mới`}>
        <form className="stack-lg" onSubmit={save}>
          {notice && <p className="alert ok"><Icon name="mail" size={16} />{notice}</p>}
          {IS_DEMO && demoToken && (
            <p className="hint"><Icon name="key" size={15} /> Bản demo không gửi email thật. Mã của bạn: <b>{demoToken}</b>
              <button type="button" className="link-btn" onClick={() => setToken(demoToken)}>Dán mã</button></p>
          )}
          {IS_DEMO && !demoToken && (
            <p className="alert warn"><Icon name="alert" size={16} /><span>Bản demo không có tài khoản nào dùng email <b>{email}</b> nên không có mã.
              Bấm <b>Gửi lại mã</b> và nhập một email có sẵn: <b>customer1@example.com</b>, <b>customer2@example.com</b>, <b>staff1@example.com</b>.</span></p>
          )}
          <Field label="Mã xác minh">
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Dán mã trong email" autoComplete="one-time-code" required />
          </Field>
          <Field label="Mật khẩu mới">
            <PasswordInput value={password} onChange={setPassword} placeholder="Ít nhất 8 ký tự" autoComplete="new-password" />
          </Field>
          <Field label="Nhập lại mật khẩu mới">
            <PasswordInput value={confirm} onChange={setConfirm} placeholder="Nhập lại mật khẩu" autoComplete="new-password" />
          </Field>
          <p className="hint"><Icon name="clock" size={15} /> Mã có hiệu lực 30 phút và chỉ dùng được một lần.</p>
          {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
          <button className="btn primary block lg upper" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Đặt lại mật khẩu'}</button>
          <button className="btn ghost block" type="button" onClick={() => { setStep('email'); setError('') }}>Gửi lại mã</button>
        </form>
        {back}
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Đổi mật khẩu thành công" subtitle="Bạn có thể đăng nhập bằng mật khẩu mới">
      <div className="stack-lg">
        <p className="alert ok"><Icon name="check" size={16} />Mật khẩu của tài khoản đã được cập nhật.</p>
        <button className="btn primary block lg upper" onClick={() => navigate('/login')}>Đăng nhập</button>
      </div>
    </AuthShell>
  )
}
