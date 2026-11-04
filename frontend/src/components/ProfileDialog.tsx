import { useEffect, useState } from 'react'
import { api, fmtDate } from '../api'
import { useAuth } from '../auth'
import { roleLabel, Roles, type AccountProfile } from '../types'
import { staffCode } from '../validation'
import { mask, maskEmail } from '../pages/AccountSecurity'
import { ProfileForm } from '../pages/AccountProfile'
import { Modal } from './Modal'
import { Icon } from './ui'

/** Staff / admin sidebar: clicking your own name shows your details here, without leaving the console. */
export function ProfileDialog({ onClose }: { onClose: () => void }) {
  const { user, refresh } = useAuth()
  const role = user?.role ?? ''
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [notice, setNotice] = useState('')
  const back = (msg: string) => { setMode('view'); setNotice(msg) }
  const [p, setP] = useState<AccountProfile | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api<AccountProfile>('/api/auth/profile').then(setP).catch((e) => setError((e as Error).message))
  }, [])

  return (
    <Modal title={mode === 'edit' ? 'Sửa thông tin' : 'Thông tin cá nhân'} onClose={onClose}>
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      {!p ? (!error && <p className="muted">Đang tải…</p>) : mode === 'edit' ? (
        <ProfileForm bare profile={p} onCancel={() => setMode('view')} onSaved={(x) => { setP(x); void refresh(); back('Đã lưu thông tin tài khoản.') }} />
      ) : (
        <div className="stack">
          {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
          <div className="row">
            <span className="avatar lg">{p.fullName.trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase()}</span>
            <div className="grow"><b>{p.fullName}</b><small className="muted block">{roleLabel(p.role ?? role)}</small></div>
          </div>
          {(p.role ?? role) !== Roles.Customer && <div className="info-row"><span className="muted">Mã nhân viên</span><b className="code-chip">{staffCode(p.userId)}</b></div>}
          <div className="info-row"><span className="muted">Tên đăng nhập</span><b>{p.username}</b></div>
          <div className="info-row"><span className="muted">Email</span><b>{maskEmail(p.email)}</b></div>
          <div className="info-row"><span className="muted">Số điện thoại</span><b>{mask(p.phoneNumber)}</b></div>
          <div className="info-row"><span className="muted">Địa chỉ</span><b>{p.address?.trim() ? p.address : '—'}</b></div>
          <div className="info-row"><span className="muted">Số CCCD</span><b>{mask(p.citizenId, 4)}</b></div>
          <div className="info-row"><span className="muted">Ngày tạo</span><b>{fmtDate(p.createdAt)}</b></div>
          <div className="row wrap">
            <button type="button" className="btn primary" onClick={() => { setNotice(''); setMode('edit') }}><Icon name="settings" size={15} /> Sửa thông tin</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
