import { useState, type FocusEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { confirmError, emailError, passwordError } from '../validation'
import { api, ApiError, IS_DEMO } from '../api'
import { Icon } from '../components/ui'
import { FormField, leavingToSubmit, PasswordChecklist } from '../components/form'
import { AuthShell, PasswordInput } from './Login'

/**
 * Forgot / reset password, Figma "forgot-password" (45:1230) on the same split layout as login.
 * 1. Email → POST /api/auth/forgot-password: the backend emails a single-use code, valid 30 minutes.
 * 2. Code + new password → POST /api/auth/reset-password.
 * The demo build sends no email, so its mock backend returns the code and it is shown on screen.
 * Both endpoints share a rate limit (5 requests / 15 minutes per IP): 429 is shown in Vietnamese.
 */

/** Messages for the answers the API gives without Vietnamese text. */
function explain(err: unknown, sending: boolean): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Bạn đã thử quá nhiều lần. Vui lòng đợi khoảng 15 phút rồi thử lại.'
    if (err.status === 503 && sending)
      return `${err.message} Vui lòng thử lại sau ít phút hoặc liên hệ cơ sở để được hỗ trợ.`
  }
  return (err as Error).message
}
const DEMO_EMAILS = ['customer1@example.com', 'customer2@example.com', 'staff1@example.com']

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
  // Field errors show after the user leaves a field or presses the button.
  const [shown, setShown] = useState<Record<string, boolean>>({})
  const show = (k: string) => (e: FocusEvent) => { if (!leavingToSubmit(e)) setShown((x) => ({ ...x, [k]: true })) }
  const emailErr = shown.email ? emailError(email) : null
  const passwordErr = shown.password ? passwordError(password) : null
  const confirmErr = shown.confirm ? confirmError(password, confirm) : null
  const tokenErr = shown.token && !token.trim() ? 'Vui lòng dán mã trong email' : null

  const run = async (fn: () => Promise<void>, sending = false) => {
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setError(explain(err, sending))
    } finally {
      setBusy(false)
    }
  }

  const send = (e: FormEvent) => {
    e.preventDefault()
    setShown((x) => ({ ...x, email: true }))
    if (emailError(email)) return
    void run(async () => {
      const res = await api<{ message: string; demoToken?: string }>('/api/auth/forgot-password', { body: { email: email.trim() } })
      setNotice(res.message)
      setDemoToken(res.demoToken ?? '')
      setToken('')
      setStep('reset')
    }, true)
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    // The code is long (43 characters); copying it from an email can bring spaces or line breaks along.
    const code = token.replace(/\s+/g, '')
    setShown({ token: true, password: true, confirm: true })
    if (!code || passwordError(password) || confirmError(password, confirm)) return
    if (code.length > 100) return setError('Mã không hợp lệ, hãy copy lại đúng mã trong email')
    void run(async () => {
      await api('/api/auth/reset-password', { body: { token: code, newPassword: password } })
      setStep('done')
    })
  }

  const back = <p className="switch-link">Đã nhớ mật khẩu? <Link to="/login">Quay lại đăng nhập</Link></p>

  if (step === 'email') {
    return (
      <AuthShell title="Quên mật khẩu" subtitle="Vui lòng nhập email để đặt lại mật khẩu">
        <form className="stack-lg" onSubmit={send} noValidate>
          <FormField label="Email" error={emailErr}>
            <input type="email" maxLength={100} value={email} onChange={(e) => setEmail(e.target.value)} onBlur={show('email')} aria-invalid={!!emailErr || undefined}
              placeholder="user@safekeep.com.vn" autoComplete="email" autoFocus />
          </FormField>
          {IS_DEMO && (
            <p className="hint demo-emails"><Icon name="mail" size={15} /> <span>Bản demo không gửi email thật; mã hiện ngay trên màn hình. Chọn email có sẵn hoặc email của tài khoản bạn vừa đăng ký trong demo:{' '}
              {DEMO_EMAILS.map((e) => <button key={e} type="button" className="link-btn" onClick={() => setEmail(e)}>{e}</button>)}</span></p>
          )}
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
        <form className="stack-lg" onSubmit={save} noValidate>
          {notice && <p className="alert ok"><Icon name="mail" size={16} />{notice}</p>}
          {IS_DEMO && demoToken && (
            <p className="hint"><Icon name="key" size={15} /> Bản demo không gửi email thật. Mã của bạn: <b>{demoToken}</b>
              <button type="button" className="link-btn" onClick={() => setToken(demoToken)}>Dán mã</button></p>
          )}
          {IS_DEMO && !demoToken && (
            <p className="alert warn"><Icon name="alert" size={16} /><span>Bản demo không có tài khoản nào dùng email <b>{email}</b> nên không có mã.
              Bấm <b>Gửi lại mã</b> và nhập một email có sẵn: <b>customer1@example.com</b>, <b>customer2@example.com</b>, <b>staff1@example.com</b>.</span></p>
          )}
          <FormField label="Mã xác minh" error={tokenErr}>
            <input value={token} onChange={(e) => setToken(e.target.value)} onBlur={show('token')} aria-invalid={!!tokenErr || undefined}
              placeholder="Dán mã trong email" autoComplete="one-time-code" spellCheck={false} />
          </FormField>
          <FormField label="Mật khẩu mới" error={passwordErr}>
            <PasswordInput value={password} onChange={setPassword} onBlur={show('password')} invalid={!!passwordErr}
              placeholder="Ít nhất 8 ký tự, có chữ hoa, chữ thường, số" autoComplete="new-password" />
            <PasswordChecklist value={password} />
          </FormField>
          <FormField label="Nhập lại mật khẩu mới" error={confirmErr}>
            <PasswordInput value={confirm} onChange={setConfirm} onBlur={show('confirm')} invalid={!!confirmErr} placeholder="Nhập lại mật khẩu" autoComplete="new-password" />
          </FormField>
          <p className="hint"><Icon name="clock" size={15} /> Mã có hiệu lực 30 phút và chỉ dùng được một lần. Không thấy thư? Xem cả mục Spam; gửi lại mã sẽ làm mã cũ hết hiệu lực.</p>
          {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
          <button className="btn primary block lg upper" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Đặt lại mật khẩu'}</button>
          <button className="btn ghost block" type="button" onClick={() => { setStep('email'); setError(''); setShown({}) }}>Gửi lại mã</button>
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
