import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, fmtMoney, fmtTime } from '../api'
import { useAuth } from '../auth'
import { Empty, Icon } from '../components/ui'
import { PageHero } from '../components/layout'
import type { AccessRecord, AccountActivity, AccountProfile, Contract, Invoice } from '../types'
import { checkPassword } from '../validation'
import { PasswordInput } from './Login'

/**
 * Figma "Bảo mật tài khoản & hợp đồng" (96:10597), trimmed by the team: no alert settings, devices or OTP.
 * The security log comes first, split into five buttons (all, sign-in & account, gate entries, payments, contracts),
 * merging GET /api/auth/me/activity (empty when the backend lacks it) with each contract's access history and the payments made.
 * Beside it: account information and change password.
 */

const missing = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405)
/** Hides all but the last characters of a phone number or CCCD. */
export const mask = (s: string | null | undefined, keep = 3) => (s ? `${'•'.repeat(Math.max(0, s.length - keep))}${s.slice(-keep)}` : '—')
export const maskEmail = (e: string) => { const [n, d] = e.split('@'); return d ? `${n.slice(0, 2)}${'•'.repeat(Math.max(1, n.length - 2))}@${d}` : e }

type LogRow = { key: string; at: string; group: 'account' | 'access' | 'payment' | 'contract'; title: string; detail: string; result: string; to?: string }
const GROUPS: { key: '' | LogRow['group']; label: string; icon: string }[] = [
  { key: '', label: 'Tất cả', icon: 'history' },
  { key: 'account', label: 'Đăng nhập & tài khoản', icon: 'user' },
  { key: 'access', label: 'Ra vào kho', icon: 'lock' },
  { key: 'payment', label: 'Thanh toán', icon: 'wallet' },
  { key: 'contract', label: 'Hợp đồng', icon: 'clipboard' },
]
const RESULT: Record<string, { label: string; tone: string }> = {
  Success: { label: 'Thành công', tone: 'ok' }, Granted: { label: 'Cho vào', tone: 'ok' },
  Warning: { label: 'Cần chú ý', tone: 'warn' }, Denied: { label: 'Từ chối', tone: 'bad' }, Failed: { label: 'Thất bại', tone: 'bad' },
  Refunded: { label: 'Hoàn tiền', tone: 'info' },
}

export default function AccountSecurity() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [log, setLog] = useState<LogRow[] | null>(null)
  const [group, setGroup] = useState<'' | LogRow['group']>('')
  const [msg, setMsg] = useState<string>('')
  const [changing, setChanging] = useState(false)

  const load = useCallback(async () => {
    api<AccountProfile>('/api/auth/profile').then(setProfile).catch(() => {})

    const rows: LogRow[] = []
    const [activity, contracts, invoices] = await Promise.all([
      api<AccountActivity[]>('/api/auth/me/activity').catch(() => [] as AccountActivity[]),
      api<Contract[]>('/api/contracts/my').catch(() => [] as Contract[]),
      api<Invoice[]>('/api/invoices/my').catch(() => [] as Invoice[]),
    ])
    for (const a of activity) {
      rows.push({ key: `a${a.logId}`, at: a.createdAt, group: a.category === 'Contract' ? 'contract' : 'account', title: a.action,
        detail: [a.details, a.ipAddress && `IP ${a.ipAddress}`].filter(Boolean).join(' · '), result: a.result })
    }
    const access = await Promise.all(contracts.map((c) => api<AccessRecord[]>(`/api/contracts/${c.contractId}/access-history`).catch(() => [] as AccessRecord[])))
    access.forEach((rs, ci) => rs.forEach((r, n) => rows.push({ key: `r${r.accessRecordId}-${ci}-${n}`, at: r.entryTime, group: 'access',
      title: `${r.result === 'Granted' ? 'Vào kho' : 'Bị từ chối vào kho'} ${r.unitCode}`,
      detail: [r.visitorName, r.exitTime && `ra lúc ${fmtTime(r.exitTime)}`, r.verifiedBy && `NV ${r.verifiedBy}`].filter(Boolean).join(' · '), result: r.result })))
    invoices.forEach((i) => i.payments.forEach((p, n) => rows.push({ key: `p${i.invoiceId}-${p.paymentId}-${n}`, at: p.paymentDate, group: 'payment', to: `/invoices/${i.invoiceId}`,
      title: `${p.status === 'Refunded' ? 'Hoàn tiền' : 'Thanh toán'} ${i.invoiceNumber}`, detail: `${fmtMoney(p.amountPaid)} · ${p.paymentMethod}`,
      result: p.status === 'Success' ? 'Success' : p.status === 'Refunded' ? 'Refunded' : p.status === 'Failed' ? 'Failed' : 'Warning' })))
    contracts.forEach((c) => rows.push({ key: `c${c.contractId}`, at: `${c.startDate}T08:00:00`, group: 'contract', to: `/my-units/${c.contractId}`,
      title: `Hợp đồng ${c.contractNumber} có hiệu lực`, detail: `Kho ${c.unitCode} · ${c.facilityName}`, result: 'Success' }))
    setLog(rows.sort((a, b) => b.at.localeCompare(a.at)))
  }, [])
  useEffect(() => { void load() }, [load])

  const shown = useMemo(() => (log ?? []).filter((r) => !group || r.group === group).slice(0, 50), [log, group])
  const count = (g: '' | LogRow['group']) => (log ?? []).filter((r) => !g || r.group === g).length
  const current = GROUPS.find((g) => g.key === group) ?? GROUPS[0]
  const p = profile

  return (
    <>
      <PageHero eyebrow="Tài khoản khách hàng" title="Bảo Mật Tài Khoản & Hợp Đồng">
        Xem nhật ký đăng nhập, ra vào kho, thanh toán và hợp đồng của tài khoản; đổi mật khẩu khi cần.
      </PageHero>
      <div className="container page-body">
        <div className="notice info-notice">
          <span className="notice-icon info"><Icon name="shield" size={16} /></span>
          <div><b>Kho của bạn được bảo vệ bằng CCCD</b><p>Mỗi lượt vào kho, nhân viên cổng đối chiếu CCCD của chủ hợp đồng hoặc người được ủy quyền. Không dùng mã PIN hay OTP.</p></div>
        </div>
        {msg && <p className="alert ok"><Icon name="check" size={16} />{msg}</p>}

        <div className="policy-layout">
          <section className="panel stack">
            <div><h2 className="panel-title">Nhật ký bảo mật & hợp đồng</h2><p className="muted">Chọn mục muốn xem, mới nhất trước.</p></div>
            <div className="action-tiles five" role="tablist" aria-label="Loại nhật ký">
              {GROUPS.map((g) => (
                <button key={g.key} type="button" role="tab" aria-selected={group === g.key} className={`action-tile ${group === g.key ? 'active' : ''}`} onClick={() => setGroup(g.key)}>
                  <span className="tile-icon"><Icon name={g.icon} size={18} /></span>
                  <b>{g.label}</b>
                  <small>{log ? `${count(g.key)} hoạt động` : 'Đang tải…'}</small>
                </button>
              ))}
            </div>
            <h3 className="panel-title with-icon"><Icon name={current.icon} size={17} className="cyan" /> {current.label}</h3>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Thời gian</th><th>Hoạt động</th><th>Trạng thái</th><th /></tr></thead>
                <tbody>
                  {shown.map((r) => {
                    const st = RESULT[r.result] ?? { label: r.result, tone: 'muted' }
                    return <tr key={r.key}><td>{fmtTime(r.at)}</td><td><b>{r.title}</b><br /><small className="muted">{r.detail}</small></td><td><span className={`badge ${st.tone}`}>{st.label}</span></td>
                      <td className="right">{r.to && <Link to={r.to} className="link with-icon nowrap">Xem chi tiết <Icon name="arrowRight" size={13} /></Link>}</td></tr>
                  })}
                </tbody>
              </table>
              {log && shown.length === 0 && <Empty icon="history">Chưa có hoạt động nào.</Empty>}
            </div>
          </section>

          <aside className="stack-lg policy-aside">
            <section className="panel stack-sm">
              <h3 className="panel-title">Thông tin bảo mật</h3>
              <div className="info-row"><span className="muted">Chủ tài khoản</span><b>{p?.fullName ?? user?.fullName}</b></div>
              <div className="info-row"><span className="muted">Tên đăng nhập</span><b>{p?.username ?? user?.username}</b></div>
              <div className="info-row"><span className="muted">Email</span><b>{p ? maskEmail(p.email) : '—'}</b></div>
              <div className="info-row"><span className="muted">Số điện thoại</span><b>{mask(p?.phoneNumber)}</b></div>
              <div className="info-row"><span className="muted">Số CCCD</span><b>{mask(p?.citizenId, 4)}</b></div>
              {!changing && <button type="button" className="btn outline block" onClick={() => setChanging(true)}><Icon name="key" size={15} /> Đổi mật khẩu</button>}
              {changing && <ChangePassword onDone={(ok) => { setChanging(false); if (ok) { setMsg('Đã đổi mật khẩu.'); void load() } }} />}
              <Link to="/forgot-password" className="link fine">Quên mật khẩu hiện tại?</Link>
            </section>
          </aside>
        </div>
      </div>
    </>
  )
}

function ChangePassword({ onDone }: { onDone: (ok: boolean) => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!current) return setError('Vui lòng nhập mật khẩu hiện tại')
    const weak = checkPassword(next)
    if (weak) return setError(weak.replace('Mật khẩu', 'Mật khẩu mới'))
    if (next === current) return setError('Mật khẩu mới phải khác mật khẩu hiện tại')
    if (next !== confirm) return setError('Mật khẩu nhập lại không khớp')
    setBusy(true)
    setError('')
    try {
      await api('/api/auth/change-password', { body: { currentPassword: current, newPassword: next } })
      onDone(true)
    } catch (err) {
      setError(missing(err) ? 'Đổi mật khẩu đang được hoàn thiện. Tạm thời dùng "Quên mật khẩu" để đặt lại qua email.' : (err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="stack-sm change-pw" onSubmit={submit}>
      <label className="field"><span>Mật khẩu hiện tại</span><PasswordInput value={current} onChange={setCurrent} placeholder="Mật khẩu đang dùng" autoComplete="current-password" /></label>
      <label className="field"><span>Mật khẩu mới</span><PasswordInput value={next} onChange={setNext} placeholder="Ít nhất 8 ký tự, có chữ và số" autoComplete="new-password" /></label>
      <label className="field"><span>Nhập lại mật khẩu mới</span><PasswordInput value={confirm} onChange={setConfirm} placeholder="Nhập lại" autoComplete="new-password" /></label>
      {error && <p className="alert bad"><Icon name="alert" size={15} />{error}</p>}
      <div className="row">
        <button className="btn primary sm" type="submit" disabled={busy}>{busy ? 'Đang đổi…' : 'Đổi mật khẩu'}</button>
        <button className="btn ghost sm" type="button" onClick={() => onDone(false)}>Hủy</button>
      </div>
    </form>
  )
}
