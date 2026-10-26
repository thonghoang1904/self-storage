import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, fmtMoney, fmtTime } from '../api'
import { useAuth } from '../auth'
import { Empty, Icon } from '../components/ui'
import { PageHero } from '../components/layout'
import type { AccessRecord, AccountActivity, AccountProfile, Contract, Invoice, LoginSession, SecuritySettings } from '../types'
import { checkPassword } from '../validation'
import { PasswordInput } from './Login'

/**
 * Figma "Bảo mật tài khoản & hợp đồng" (96:10597), without the OTP part (dropped by the team).
 * Security alerts, signed-in devices, account information, change password and one security log that merges
 * account events with the gate entries of every contract and the payments made.
 * Account endpoints await the backend (docs/API-cho-backend.md): GET /api/auth/me/profile, GET/PUT
 * /api/auth/me/security-settings, GET /api/auth/me/sessions, DELETE /api/auth/me/sessions/{id},
 * POST /api/auth/me/sessions/revoke-others, POST /api/auth/change-password, GET /api/auth/me/activity.
 * Entries and payments use existing APIs. The in-browser demo implements everything.
 */

const missing = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405)
const mask = (s: string | null | undefined, keep = 3) => (s ? `${'•'.repeat(Math.max(0, s.length - keep))}${s.slice(-keep)}` : '—')
const maskEmail = (e: string) => { const [n, d] = e.split('@'); return d ? `${n.slice(0, 2)}${'•'.repeat(Math.max(1, n.length - 2))}@${d}` : e }

type LogRow = { key: string; at: string; group: 'account' | 'access' | 'payment' | 'contract'; title: string; detail: string; result: string }
const GROUPS: { key: '' | LogRow['group']; label: string }[] = [
  { key: '', label: 'Tất cả' },
  { key: 'account', label: 'Đăng nhập & tài khoản' },
  { key: 'access', label: 'Ra vào kho' },
  { key: 'payment', label: 'Thanh toán' },
  { key: 'contract', label: 'Hợp đồng' },
]
const RESULT: Record<string, { label: string; tone: string }> = {
  Success: { label: 'Thành công', tone: 'ok' }, Granted: { label: 'Cho vào', tone: 'ok' },
  Warning: { label: 'Cần chú ý', tone: 'warn' }, Denied: { label: 'Từ chối', tone: 'bad' }, Failed: { label: 'Thất bại', tone: 'bad' },
  Refunded: { label: 'Hoàn tiền', tone: 'info' },
}

export default function AccountSecurity() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [settings, setSettings] = useState<SecuritySettings | null>(null)
  const [savedSettings, setSavedSettings] = useState<SecuritySettings | null>(null)
  const [sessions, setSessions] = useState<LoginSession[] | null>(null)
  const [log, setLog] = useState<LogRow[]>([])
  const [pendingApis, setPendingApis] = useState<string[]>([])
  const [group, setGroup] = useState<'' | LogRow['group']>('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [changing, setChanging] = useState(false)

  const note = (name: string) => setPendingApis((xs) => (xs.includes(name) ? xs : [...xs, name]))

  const load = useCallback(async () => {
    api<AccountProfile>('/api/auth/me/profile').then(setProfile).catch((e) => { if (missing(e)) note('thông tin tài khoản') })
    api<SecuritySettings>('/api/auth/me/security-settings').then((s) => { setSettings(s); setSavedSettings(s) }).catch((e) => { if (missing(e)) note('cài đặt cảnh báo') })
    api<LoginSession[]>('/api/auth/me/sessions').then(setSessions).catch((e) => { if (missing(e)) note('phiên đăng nhập') })

    const rows: LogRow[] = []
    const [activity, contracts, invoices] = await Promise.all([
      api<AccountActivity[]>('/api/auth/me/activity').catch((e) => { if (missing(e)) note('nhật ký tài khoản'); return [] as AccountActivity[] }),
      api<Contract[]>('/api/contracts/my').catch(() => [] as Contract[]),
      api<Invoice[]>('/api/invoices/my').catch(() => [] as Invoice[]),
    ])
    for (const a of activity) {
      rows.push({ key: `a${a.logId}`, at: a.createdAt, group: a.category === 'Contract' ? 'contract' : 'account', title: a.action,
        detail: [a.details, a.ipAddress && `IP ${a.ipAddress}`].filter(Boolean).join(' · '), result: a.result })
    }
    const access = await Promise.all(contracts.map((c) => api<AccessRecord[]>(`/api/contracts/${c.contractId}/access-history`).catch(() => [] as AccessRecord[])))
    access.flat().forEach((r, n) => rows.push({ key: `r${r.accessRecordId}-${n}`, at: r.entryTime, group: 'access',
      title: `${r.result === 'Granted' ? 'Vào kho' : 'Bị từ chối vào kho'} ${r.unitCode}`,
      detail: [r.visitorName, r.exitTime && `ra lúc ${fmtTime(r.exitTime)}`, r.verifiedBy && `NV ${r.verifiedBy}`].filter(Boolean).join(' · '), result: r.result }))
    invoices.forEach((i) => i.payments.forEach((p, n) => rows.push({ key: `p${i.invoiceId}-${p.paymentId}-${n}`, at: p.paymentDate, group: 'payment',
      title: `${p.status === 'Refunded' ? 'Hoàn tiền' : 'Thanh toán'} ${i.invoiceNumber}`, detail: `${fmtMoney(p.amountPaid)} · ${p.paymentMethod}`,
      result: p.status === 'Success' ? 'Success' : p.status === 'Refunded' ? 'Refunded' : p.status === 'Failed' ? 'Failed' : 'Warning' })))
    contracts.forEach((c) => rows.push({ key: `c${c.contractId}`, at: `${c.startDate}T08:00:00`, group: 'contract',
      title: `Hợp đồng ${c.contractNumber} có hiệu lực`, detail: `Kho ${c.unitCode} · ${c.facilityName}`, result: 'Success' }))
    setLog(rows.sort((a, b) => b.at.localeCompare(a.at)))
  }, [])
  useEffect(() => { void load() }, [load])

  const shown = useMemo(() => log.filter((r) => !group || r.group === group).slice(0, 50), [log, group])
  const dirty = !!settings && !!savedSettings && JSON.stringify(settings) !== JSON.stringify(savedSettings)

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    setMsg(null)
    try {
      await fn()
      setMsg({ tone: 'ok', text: ok })
    } catch (e) {
      setMsg({ tone: 'bad', text: missing(e) ? 'Chức năng này đang chờ backend bổ sung API.' : (e as Error).message })
    } finally {
      setBusy('')
    }
  }
  const saveSettings = () => run('settings', async () => {
    const s = await api<SecuritySettings>('/api/auth/me/security-settings', { method: 'PUT', body: settings })
    setSettings(s); setSavedSettings(s)
  }, 'Đã lưu cài đặt cảnh báo.')
  const revoke = (s: LoginSession) => run(`s${s.sessionId}`, async () => {
    await api(`/api/auth/me/sessions/${s.sessionId}`, { method: 'DELETE' })
    setSessions((xs) => xs?.filter((x) => x.sessionId !== s.sessionId) ?? null)
  }, `Đã đăng xuất ${s.device}.`)
  const revokeOthers = () => run('others', async () => {
    await api('/api/auth/me/sessions/revoke-others', { method: 'POST' })
    setSessions((xs) => xs?.filter((x) => x.current) ?? null)
  }, 'Đã đăng xuất mọi thiết bị khác.')

  const p = profile
  const toggles: { key: keyof SecuritySettings; title: string; text: string }[] = [
    { key: 'accessAlerts', title: 'Cảnh báo khi có người vào kho', text: 'Gửi email mỗi khi bạn hoặc người được ủy quyền vào / bị từ chối tại cổng.' },
    { key: 'newDeviceAlerts', title: 'Thông báo đăng nhập thiết bị lạ', text: 'Gửi email khi tài khoản đăng nhập từ thiết bị hoặc trình duyệt mới.' },
    { key: 'paymentEmails', title: 'Email hóa đơn & biên nhận', text: 'Nhận hóa đơn mới và biên nhận thanh toán qua email.' },
  ]

  return (
    <>
      <PageHero eyebrow="Tài khoản khách hàng" title="Bảo Mật Tài Khoản & Hợp Đồng">
        Quản lý cảnh báo, thiết bị đăng nhập, mật khẩu và xem nhật ký bảo mật của tài khoản và các kho bạn thuê.
      </PageHero>
      <div className="container page-body">
        <div className="notice info-notice">
          <span className="notice-icon info"><Icon name="shield" size={16} /></span>
          <div><b>Kho của bạn được bảo vệ bằng CCCD</b><p>Mỗi lượt vào kho, nhân viên cổng đối chiếu CCCD của chủ hợp đồng hoặc người được ủy quyền. Không dùng mã PIN hay OTP.</p></div>
        </div>
        {pendingApis.length > 0 && <p className="alert warn"><Icon name="clock" size={16} />Đang chờ backend bổ sung API: {pendingApis.join(', ')}. Các phần khác vẫn dùng bình thường.</p>}
        {msg && <p className={`alert ${msg.tone}`}><Icon name={msg.tone === 'ok' ? 'check' : 'alert'} size={16} />{msg.text}</p>}

        <div className="policy-layout">
          <div className="stack-lg">
            <section className="panel stack">
              <div><h2 className="panel-title">Xác thực & cảnh báo</h2><p className="muted">Chọn những thông báo bảo mật bạn muốn nhận.</p></div>
              {toggles.map((t) => (
                <label key={t.key} className="security-control">
                  <span className="grow"><b>{t.title}</b><small className="muted">{t.text}</small></span>
                  <input type="checkbox" className="switch" role="switch" checked={!!settings?.[t.key]} disabled={!settings}
                    onChange={(e) => settings && setSettings({ ...settings, [t.key]: e.target.checked })} />
                </label>
              ))}
              <div className="row end">
                <button type="button" className="btn primary sm" disabled={!dirty || busy === 'settings'} onClick={() => void saveSettings()}>{busy === 'settings' ? 'Đang lưu…' : 'Lưu cài đặt'}</button>
              </div>
            </section>

            <section className="panel stack">
              <div><h2 className="panel-title">Phiên đăng nhập & thiết bị</h2><p className="muted">Các thiết bị đang đăng nhập tài khoản {user?.username}.</p></div>
              {sessions === null ? <Empty icon="lock">Chưa tải được danh sách thiết bị.</Empty> : sessions.map((s) => (
                <div key={s.sessionId} className="device-row">
                  <span className="notice-icon info"><Icon name={/iphone|android|mobile/i.test(s.device) ? 'phone' : 'grid'} size={16} /></span>
                  <div className="grow"><b>{s.device}</b><small className="muted block">{s.location ?? 'Không rõ vị trí'} · hoạt động {fmtTime(s.lastActiveAt)}</small></div>
                  {s.current ? <span className="badge ok">Thiết bị này</span>
                    : <button type="button" className="btn ghost sm danger-text" disabled={busy !== ''} onClick={() => void revoke(s)}>Đăng xuất</button>}
                </div>
              ))}
              {sessions && sessions.some((s) => !s.current) && (
                <button type="button" className="btn outline sm self-start" disabled={busy !== ''} onClick={() => void revokeOthers()}><Icon name="logout" size={15} /> Đăng xuất mọi thiết bị khác</button>
              )}
            </section>
          </div>

          <aside className="stack-lg policy-aside">
            <section className="panel stack-sm">
              <h3 className="panel-title">Thông tin bảo mật</h3>
              <div className="info-row"><span className="muted">Chủ tài khoản</span><b>{p?.fullName ?? user?.fullName}</b></div>
              <div className="info-row"><span className="muted">Tên đăng nhập</span><b>{p?.username ?? user?.username}</b></div>
              <div className="info-row"><span className="muted">Email</span><b>{p ? maskEmail(p.email) : '—'}</b></div>
              <div className="info-row"><span className="muted">Số điện thoại</span><b>{mask(p?.phoneNumber)}</b></div>
              <div className="info-row"><span className="muted">Số CCCD</span><b>{mask(p?.citizenId, 4)}</b></div>
              {!changing && <button type="button" className="btn outline block" onClick={() => setChanging(true)}><Icon name="key" size={15} /> Đổi mật khẩu</button>}
              {changing && <ChangePassword onDone={(ok) => { setChanging(false); if (ok) { setMsg({ tone: 'ok', text: 'Đã đổi mật khẩu.' }); void load() } }} />}
              <Link to="/forgot-password" className="link fine">Quên mật khẩu hiện tại?</Link>
            </section>
            <section className="panel stack-sm">
              <h3 className="panel-title">Quyền vào kho</h3>
              <p className="muted">Quản lý người được ủy quyền và xem lịch sử ra vào theo từng kho.</p>
              <Link to="/my-units" className="btn outline block"><Icon name="users" size={15} /> Người được ủy quyền</Link>
            </section>
          </aside>
        </div>

        <section className="panel stack">
          <div><h2 className="panel-title">Nhật ký bảo mật & hợp đồng</h2><p className="muted">Đăng nhập, đổi cài đặt, ra vào kho, thanh toán và hợp đồng, mới nhất trước.</p></div>
          <div className="segmented self-start wrap" role="tablist">
            {GROUPS.map((g) => <button key={g.key} className={group === g.key ? 'active' : ''} onClick={() => setGroup(g.key)}>{g.label}</button>)}
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Thời gian</th><th>Hoạt động</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const st = RESULT[r.result] ?? { label: r.result, tone: 'muted' }
                  return <tr key={r.key}><td>{fmtTime(r.at)}</td><td><b>{r.title}</b><br /><small className="muted">{r.detail}</small></td><td><span className={`badge ${st.tone}`}>{st.label}</span></td></tr>
                })}
              </tbody>
            </table>
            {shown.length === 0 && <Empty icon="history">Chưa có hoạt động nào.</Empty>}
          </div>
        </section>
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
      setError(missing(err) ? 'Đổi mật khẩu đang chờ backend bổ sung API. Tạm thời dùng "Quên mật khẩu" để đặt lại qua email.' : (err as Error).message)
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
