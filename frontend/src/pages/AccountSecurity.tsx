import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney, fmtTime } from '../api'
import { Empty, Icon } from '../components/ui'
import { PageHero } from '../components/layout'
import type { AccessRecord, AccountActivity, Contract, Invoice } from '../types'

/**
 * Figma "Bảo mật tài khoản & hợp đồng" (96:10597), trimmed by the team: no alert settings, devices or OTP.
 * The security log comes first, split into five buttons (all, sign-in & account, gate entries, payments, contracts),
 * merging GET /api/auth/me/activity (empty when the backend lacks it) with each contract's access history and the payments made.
 * Account details live on the account page (/account/profile).
 */

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
  const [log, setLog] = useState<LogRow[] | null>(null)
  const [group, setGroup] = useState<'' | LogRow['group']>('')

  const load = useCallback(async () => {

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

  return (
    <>
      <PageHero eyebrow="Tài khoản khách hàng" title="Bảo Mật Tài Khoản & Hợp Đồng">
        Xem nhật ký đăng nhập, ra vào kho, thanh toán và hợp đồng của tài khoản.
      </PageHero>
      <div className="container page-body">
        <div className="notice info-notice">
          <span className="notice-icon info"><Icon name="shield" size={16} /></span>
          <div><b>Kho của bạn được bảo vệ bằng CCCD</b><p>Mỗi lượt vào kho, nhân viên cổng đối chiếu CCCD của chủ hợp đồng hoặc người được ủy quyền. Không dùng mã PIN hay OTP.</p></div>
        </div>

        <section className="panel stack">
          <div><h2 className="panel-title">Nhật ký</h2><p className="muted">Chọn mục muốn xem, mới nhất trước.</p></div>
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
      </div>
    </>
  )
}
