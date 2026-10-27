import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { useAuth } from '../auth'
import { FormField, useValidatedForm } from '../components/form'
import { PageHero } from '../components/layout'
import { Icon } from '../components/ui'
import { Roles, roleLabel, type AccountProfile as Profile } from '../types'
import { citizenIdError, CITIZEN_ID_FILTER, staffCode, emailError, fullNameError, NAME_FILTER, normalizePhone, PHONE_FILTER, phoneError, passwordError, textError } from '../validation'
import { PasswordInput } from './Login'

/**
 * "Thông tin tài khoản": opened by clicking your own name (header or sidebar). Any signed-in role edits its name,
 * email, phone and address (GET /api/auth/profile, PUT /api/auth/me) and changes its password
 * (POST /api/auth/change-password). The CCCD and username are shown but not editable: staff verify CCCD at the gate.
 */
export default function AccountProfile() {
  const { user, refresh } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<Profile>('/api/auth/profile').then(setProfile).catch((e) => setError((e as Error).message))
  }, [])

  if (!user) return null
  return (
    <>
      <PageHero eyebrow={roleLabel(user.role)} title="Thông Tin Tài Khoản">
        Sửa họ tên, email, số điện thoại, địa chỉ và đổi mật khẩu của tài khoản đang đăng nhập.
      </PageHero>
      <div className="container page-body">
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
        {!profile ? (!error && <p className="muted">Đang tải…</p>) : (
          <div className="policy-layout">
            <div className="stack-lg">
              <ProfileForm profile={profile} onSaved={(p) => { setProfile(p); void refresh() }} />
              <PasswordForm />
            </div>
            <aside className="stack-lg policy-aside">
              <section className="panel stack-sm">
                <div className="row">
                  <span className="avatar lg">{profile.fullName.trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase()}</span>
                  <div className="grow"><b>{profile.fullName}</b><small className="muted block">{roleLabel(profile.role ?? user.role)}</small></div>
                </div>
                {user.role !== Roles.Customer && <div className="info-row"><span className="muted">Mã nhân viên</span><b className="code-chip">{staffCode(profile.userId)}</b></div>}
                <div className="info-row"><span className="muted">Tên đăng nhập</span><b>{profile.username}</b></div>
                <div className="info-row"><span className="muted">Số CCCD</span><b>{profile.citizenId ?? '—'}</b></div>
                <div className="info-row"><span className="muted">Ngày tạo</span><b>{fmtDate(profile.createdAt)}</b></div>
                <small className="muted">Tên đăng nhập và số CCCD không tự sửa được; cần đổi CCCD vui lòng liên hệ cơ sở.</small>
                {user.role === Roles.Customer && <Link to="/account/security" className="btn outline block"><Icon name="shield" size={15} /> Bảo mật & nhật ký</Link>}
              </section>
            </aside>
          </div>
        )}
      </div>
    </>
  )
}

function ProfileForm({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  // An account without a CCCD (e.g. made by an admin) may fill it in once; after that only staff change it.
  const needsCid = !profile.citizenId
  const initial = { fullName: profile.fullName, email: profile.email, phoneNumber: profile.phoneNumber, address: profile.address ?? '', citizenId: '' }
  const form = useValidatedForm(
    initial,
    { fullName: fullNameError, email: emailError, phoneNumber: phoneError, address: (v) => textError(v, 'Địa chỉ', 5, 255, true),
      citizenId: (v) => (v ? citizenIdError(v) : null) },
    { fullName: NAME_FILTER, phoneNumber: PHONE_FILTER, citizenId: CITIZEN_ID_FILTER },
  )
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const f = form.values
  const changed = f.fullName.trim() !== profile.fullName || f.email.trim() !== profile.email
    || normalizePhone(f.phoneNumber) !== profile.phoneNumber || f.address.trim() !== (profile.address ?? '') || (needsCid && !!f.citizenId)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setMsg(null)
    if (!form.validateAll()) return
    setBusy(true)
    try {
      const p = await api<Profile>('/api/auth/me', {
        method: 'PUT',
        body: { fullName: f.fullName.trim(), email: f.email.trim(), phoneNumber: normalizePhone(f.phoneNumber), address: f.address.trim() || null,
          ...(needsCid && f.citizenId ? { citizenId: f.citizenId } : {}) },
      })
      form.reset({ fullName: p.fullName, email: p.email, phoneNumber: p.phoneNumber, address: p.address ?? '', citizenId: '' })
      onSaved(p)
      setMsg({ tone: 'ok', text: 'Đã lưu thông tin tài khoản.' })
    } catch (err) {
      setMsg({ tone: 'bad', text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="panel stack" onSubmit={save} noValidate>
      <div><h2 className="panel-title">Thông tin cá nhân</h2><p className="muted">Email dùng để nhận hóa đơn, mã đặt lại mật khẩu và thông báo.</p></div>
      <div className="form-grid two">
        <FormField label="Họ và tên *" error={form.error('fullName')}><input {...form.field('fullName')} maxLength={100} autoComplete="name" /></FormField>
        <FormField label="Số điện thoại *" error={form.error('phoneNumber')}><input {...form.field('phoneNumber')} inputMode="tel" maxLength={15} autoComplete="tel" /></FormField>
        <FormField label="Email *" error={form.error('email')}><input {...form.field('email')} type="email" maxLength={100} autoComplete="email" /></FormField>
        <FormField label="Địa chỉ" error={form.error('address')}><input {...form.field('address')} maxLength={255} autoComplete="street-address" placeholder="Không bắt buộc" /></FormField>
        {needsCid && (
          <FormField label="Số CCCD" error={form.error('citizenId')}>
            <input {...form.field('citizenId')} inputMode="numeric" maxLength={12} placeholder="12 chữ số trên thẻ CCCD" />
          </FormField>
        )}
      </div>
      {needsCid && <small className="muted">Tài khoản chưa có số CCCD. Bạn chỉ tự nhập được một lần; sau đó muốn sửa phải mang thẻ CCCD đến cơ sở. Cần có CCCD để đăng ký vào kho.</small>}
      {msg && <p className={`alert ${msg.tone}`}><Icon name={msg.tone === 'ok' ? 'check' : 'alert'} size={16} />{msg.text}</p>}
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy || !changed}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button>
        {changed && <button className="btn ghost" type="button" onClick={() => { form.reset(initial); setMsg(null) }}>Hủy</button>}
      </div>
    </form>
  )
}

function PasswordForm() {
  const form = useValidatedForm(
    { current: '', next: '', confirm: '' },
    {
      current: (v) => (v ? null : 'Nhập mật khẩu hiện tại'),
      next: (v, all) => passwordError(v) ?? (v && v === all.current ? 'Mật khẩu mới phải khác mật khẩu hiện tại' : null),
      confirm: (v, all) => (!v ? 'Nhập lại mật khẩu mới' : v !== all.next ? 'Mật khẩu nhập lại không khớp' : null),
    },
  )
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setMsg(null)
    if (!form.validateAll()) return
    setBusy(true)
    try {
      await api('/api/auth/change-password', { body: { currentPassword: form.values.current, newPassword: form.values.next } })
      form.reset()
      setMsg({ tone: 'ok', text: 'Đổi mật khẩu thành công.' })
    } catch (err) {
      setMsg({ tone: 'bad', text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const pw = (k: 'current' | 'next' | 'confirm', autoComplete: string, placeholder: string) => {
    const fld = form.field(k)
    return <PasswordInput value={form.values[k]} onChange={(v) => form.setValue(k, v)} onBlur={fld.onBlur} invalid={!!form.error(k)} inputRef={fld.ref} autoComplete={autoComplete} placeholder={placeholder} />
  }
  return (
    <form className="panel stack" onSubmit={submit} noValidate>
      <div><h2 className="panel-title">Đổi mật khẩu</h2><p className="muted">Ít nhất 8 ký tự, có chữ hoa, chữ thường và số.</p></div>
      <FormField label="Mật khẩu hiện tại" error={form.error('current')}>{pw('current', 'current-password', 'Mật khẩu đang dùng')}</FormField>
      <div className="form-grid two">
        <FormField label="Mật khẩu mới" error={form.error('next')}>{pw('next', 'new-password', 'Mật khẩu mới')}</FormField>
        <FormField label="Nhập lại mật khẩu mới" error={form.error('confirm')}>{pw('confirm', 'new-password', 'Nhập lại mật khẩu mới')}</FormField>
      </div>
      {msg && <p className={`alert ${msg.tone}`}><Icon name={msg.tone === 'ok' ? 'check' : 'alert'} size={16} />{msg.text}</p>}
      <button className="btn primary self-start" type="submit" disabled={busy}>{busy ? 'Đang đổi…' : 'Đổi mật khẩu'}</button>
    </form>
  )
}
