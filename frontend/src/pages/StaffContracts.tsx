import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { localToday } from '../validation'
import { api, fmtDate, fmtMoney } from '../api'
import { useStaffFacility } from '../components/layout'
import { Empty, Icon, StatusBadge } from '../components/ui'
import type { Invoice, OverdueSummary, Renewal, StaffContract } from '../types'
import { Select } from '../components/Select'
import { StatChip, scrollToList } from '../components/StatCard'
import { ContractDialog } from './FacilityContracts'

/** Figma "renewals-overdue": metrics, filters, one table of contracts to renew or collect, collection rule. */

type Kind = 'renewal' | 'ending' | 'overdue' | 'unpaid' | 'active' | 'ended'
interface Row {
  contract: StaffContract
  kind: Kind
  daysLeft: number
  amountDue: number
  renewal?: Renewal
  overdue?: OverdueSummary
  /** Rent / extra-charge / fine invoices still open on the contract (what the billing page can collect). */
  bills: Invoice[]
}
const BILL_TYPES = ['MONTHLY_RENT', 'EXTRA_CHARGE', 'OVERDUE_FINE']
const ORDER: Kind[] = ['overdue', 'unpaid', 'renewal', 'ending', 'active', 'ended']

const DAY = 86400000
const asLocal = (iso: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso)
const daysUntil = (iso: string) => Math.ceil((asLocal(iso).getTime() - new Date().setHours(0, 0, 0, 0)) / DAY)
const KIND_LABEL: Record<Kind, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted' }> = {
  renewal: { label: 'Chờ thu phí gia hạn', tone: 'warn' },
  ending: { label: 'Sắp hết hạn', tone: 'info' },
  overdue: { label: 'Quá hạn · khóa kho', tone: 'bad' },
  unpaid: { label: 'Nợ hóa đơn', tone: 'bad' },
  active: { label: 'Đang thuê', tone: 'ok' },
  ended: { label: 'Đã kết thúc', tone: 'muted' },
}
const PAGE_SIZE = 8
const endingSoon = (r: { kind: Kind; daysLeft: number }) => r.kind === 'ending' || (r.kind === 'renewal' && r.daysLeft <= 7)

export default function StaffContracts() {
  const { facilityId } = useStaffFacility()
  const [contracts, setContracts] = useState<StaffContract[]>([])
  const [renewals, setRenewals] = useState<Renewal[]>([])
  const [overdue, setOverdue] = useState<OverdueSummary[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [q, setQ] = useState('')
  const [viewing, setViewing] = useState<StaffContract | null>(null)
  const [kind, setKind] = useState<'open' | 'live' | 'soon' | Kind | 'all'>('all')
  const [within, setWithin] = useState<'all' | '7' | '30'>('all')
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!facilityId) return
    try {
      const [c, r, o] = await Promise.all([
        api<StaffContract[]>(`/api/contracts/facilities/${facilityId}`),
        api<Renewal[]>(`/api/contracts/facilities/${facilityId}/renewals`),
        api<OverdueSummary[]>(`/api/contracts/facilities/${facilityId}/overdue`),
      ])
      setContracts(c)
      setRenewals(r)
      setOverdue(o)
      setInvoices(await api<Invoice[]>(`/api/invoices/facilities/${facilityId}`).catch(() => []))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [facilityId])
  useEffect(() => { void load() }, [load])

  const rows = useMemo<Row[]>(() => contracts.map((c) => {
    const renewal = renewals.find((r) => r.contractId === c.contractId)
    const od = overdue.find((o) => o.contractId === c.contractId)
    const daysLeft = daysUntil(c.endDate)
    const today = localToday()
    const bills = invoices.filter((i) => i.contractId === c.contractId && BILL_TYPES.includes(i.invoiceType)
      && (i.status === 'Unpaid' || i.status === 'Overdue'))
    // Past their due date these block the gate (AccessService: "Còn hóa đơn … quá hạn").
    const lateBills = bills.filter((i) => i.status === 'Overdue' || i.dueDate < today)
    const kind: Kind = c.status === 'Terminated' || c.status === 'Liquidated' ? 'ended'
      : od || c.status === 'Overdue' ? 'overdue'
      : lateBills.length ? 'unpaid'
      : renewal ? 'renewal'
      : daysLeft <= 7 ? 'ending' : 'active'
    const billsDue = bills.reduce((n, i) => n + i.totalAmount, 0)
    // The late fee is not an invoice yet: it is billed (or taken from the deposit) when the unit is returned.
    const amountDue = (renewal ? renewal.renewalFee : 0) + billsDue + (od ? od.accumulatedLateFee : 0)
    return { contract: c, kind, daysLeft, amountDue, renewal, overdue: od, bills }
  }), [contracts, renewals, overdue, invoices])

  const shown = rows
    .filter((r) => kind === 'all' ? true : kind === 'open' ? r.kind !== 'active' && r.kind !== 'ended'
      : kind === 'live' ? r.kind !== 'ended' : kind === 'soon' ? endingSoon(r) : r.kind === kind)
    .filter((r) => within === 'all' || (r.kind !== 'ended' && r.daysLeft <= Number(within)))
    .filter((r) => {
      const s = q.trim().toLowerCase()
      if (!s) return true
      const c = r.contract
      return [c.contractNumber, c.customerName, c.customerPhone, c.unitCode].some((v) => v.toLowerCase().includes(s))
    })
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.daysLeft - b.daysLeft)
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const pageRows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  // What staff can do with one contract; shown in the contract dialog (opened from the contract number).
  const actionsFor = (r: Row) => {
    const c = r.contract
    const canReturn = (c.status === 'Active' || c.status === 'Overdue') && new Date(c.returnAppointment) <= new Date()
    const items = [
      r.renewal && (
        <button key="reject" className="btn ghost sm danger-text" disabled={busyId !== null}
          onClick={() => {
            if (!window.confirm(`Từ chối yêu cầu gia hạn ${c.contractNumber}? Hóa đơn gia hạn chưa thanh toán sẽ bị hủy.`)) return
            setViewing(null)
            act(c.contractId, () => api(`/api/contracts/renewals/${r.renewal!.renewalId}/reject`, { method: 'POST' }), `Đã từ chối yêu cầu gia hạn ${c.contractNumber}.`)
          }}>
          Từ chối gia hạn
        </button>
      ),
      canReturn && <Link key="return" to={`/staff-return?contract=${c.contractId}`} className="btn outline sm"><Icon name="door" size={14} /> Trả kho & hoàn cọc</Link>,
      c.status === 'Terminated' && <Link key="refund" to={`/staff-return?contract=${c.contractId}`} className="btn ghost sm">Hoàn cọc</Link>,
    ].filter(Boolean)
    return items.length ? <>{items}</> : undefined
  }
  const viewingRow = viewing ? rows.find((x) => x.contract.contractId === viewing.contractId) : undefined

  const act = async (id: number, fn: () => Promise<unknown>, done: string) => {
    setError('')
    setNotice('')
    setBusyId(id)
    try {
      await fn()
      setNotice(done)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const exportCsv = () => {
    const head = ['Mã HĐ', 'Khách hàng', 'SĐT', 'Kho', 'Ngày hết hạn', 'Còn lại (ngày)', 'Số tiền cần thu', 'Trạng thái']
    const lines = shown.map((r) => [r.contract.contractNumber, r.contract.customerName, r.contract.customerPhone, r.contract.unitCode,
      fmtDate(r.contract.endDate), r.kind === 'ended' ? '' : String(r.daysLeft), String(r.amountDue), KIND_LABEL[r.kind].label])
    const csv = '﻿' + [head, ...lines].map((l) => l.map((v) => `"${v.replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `gia-han-qua-han-${localToday()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const active = rows.filter((r) => r.kind !== 'ended').length
  // A card shows the rows it counts; clicking the active card again shows everything.
  const pick = (k: typeof kind) => { setKind(kind === k ? 'all' : k); setWithin('all'); setQ(''); setPage(1); scrollToList('contract-list') }
  const lateFees = overdue.reduce((s, o) => s + o.accumulatedLateFee, 0)

  return (
    <div className="stack-xl">
      {viewing && facilityId && <ContractDialog contract={viewing} facilityId={facilityId} onClose={() => setViewing(null)} actions={viewingRow ? actionsFor(viewingRow) : undefined} />}
      <div className="page-top">
        <div>
          <h1>Gia Hạn & Quá Hạn</h1>
          <p className="muted">Theo dõi hợp đồng sắp hết hạn, thu phí gia hạn và xử lý kho quá hạn tại cơ sở.</p>
        </div>
        <div className="stat-chips">
          <StatChip icon="clipboard" tone="info" label="hiệu lực" value={active} active={kind === 'live'} onClick={() => pick('live')} />
          <StatChip icon="refresh" tone="warn" label="chờ phí gia hạn" value={renewals.length} extra={renewals.length ? fmtMoney(renewals.reduce((s, r) => s + r.renewalFee, 0)) : undefined}
            active={kind === 'renewal'} onClick={() => pick('renewal')} />
          <StatChip icon="calendar" tone="ok" label="hết hạn ≤ 7 ngày" value={rows.filter(endingSoon).length} hint="Nhắc khách gia hạn hoặc trả kho" active={kind === 'soon'} onClick={() => pick('soon')} />
          <StatChip icon="lock" tone="bad" label="quá hạn · khóa" value={overdue.length} extra={overdue.length ? `${fmtMoney(lateFees)} phí` : undefined}
            active={kind === 'overdue'} onClick={() => pick('overdue')} />
          <button className="btn outline sm" onClick={exportCsv}><Icon name="clipboard" size={14} /> Xuất danh sách</button>
        </div>
      </div>

      <div className="panel filter-bar">
        <div className="filter-controls">
          <span className="input-wrap grow-2">
            <Icon name="search" size={16} className="input-lead" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Tìm mã HĐ, khách hàng, SĐT, kho…" />
          </span>
          <Select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setPage(1) }}>
            <option value="all">Tất cả trạng thái</option>
            <option value="open">Cần xử lý</option>
            <option value="live">Hợp đồng hiệu lực</option>
            <option value="soon">Hết hạn trong 7 ngày</option>
            <option value="renewal">Chờ thu phí gia hạn</option>
            <option value="ending">Sắp hết hạn</option>
            <option value="overdue">Quá hạn</option>
            <option value="unpaid">Nợ hóa đơn</option>
            <option value="active">Đang thuê</option>
            <option value="ended">Đã kết thúc</option>
          </Select>
          <Select value={within} onChange={(e) => { setWithin(e.target.value as typeof within); setPage(1) }}>
            <option value="all">Mọi thời hạn</option>
            <option value="7">Hết hạn ≤ 7 ngày</option>
            <option value="30">Hết hạn ≤ 30 ngày</option>
          </Select>
        </div>
        <button className="btn ghost" onClick={() => { setQ(''); setKind('all'); setWithin('all'); setPage(1) }}>Xóa bộ lọc</button>
      </div>

      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <section className="panel" id="contract-list">
        <div>
          <h2 className="panel-title">Danh sách gia hạn & quá hạn</h2>
          <p className="muted">Bấm mã hợp đồng để xem hợp đồng và hóa đơn. Khách tự chuyển khoản phí gia hạn; kho quá hạn chuyển sang kiểm tra trả kho.</p>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Mã HĐ</th><th>Khách hàng</th><th>Kho</th><th>Ngày hết hạn</th><th>Thời gian còn lại</th><th>Số tiền cần thu</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {pageRows.map((r) => {
                const c = r.contract
                const k = KIND_LABEL[r.kind]
                return (
                  <tr key={c.contractId}>
                    <td className="code"><button type="button" className="link-btn link" onClick={() => setViewing(c)} title="Xem hợp đồng và hóa đơn">{c.contractNumber}</button></td>
                    <td><b>{c.customerName}</b><br /><small className="muted">{c.customerPhone}</small></td>
                    <td>{c.unitCode} <StatusBadge status={c.unitStatus} /></td>
                    <td>{fmtDate(c.endDate)}</td>
                    <td>{r.kind === 'ended' ? '—'
                      : r.overdue ? <span className="danger-text"><b>Quá {r.overdue.daysOverdue} ngày</b></span>
                      : r.daysLeft < 0 ? <span className="danger-text">Quá {-r.daysLeft} ngày</span>
                      : r.daysLeft === 0 ? <span className="warn-text">Hết hạn hôm nay</span>
                      : <span className={r.daysLeft <= 7 ? 'warn-text' : ''}>Còn {r.daysLeft} ngày</span>}</td>
                    <td className="money">{r.amountDue > 0 ? fmtMoney(r.amountDue) : '—'}
                      {r.renewal && <><br /><small className="muted">Gia hạn {r.renewal.extensionMonths} tháng</small></>}
                      {r.bills.length > 0 && <><br /><small className="muted">{r.bills.length} hóa đơn chưa trả</small></>}
                      {r.overdue && <><br /><small className="muted">Phí quá hạn {fmtMoney(r.overdue.accumulatedLateFee)} · thu khi trả kho</small></>}
                      {r.overdue && <><br /><small className="muted">Cọc còn {fmtMoney(r.overdue.depositBalance)}</small></>}</td>
                    <td><span className={`badge ${k.tone}`}>{k.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {pageRows.length === 0 && <Empty icon="clipboard">Không có hợp đồng nào khớp bộ lọc.</Empty>}
        </div>
        <div className="row between wrap">
          <small className="muted">Hiển thị {pageRows.length} / {shown.length} hợp đồng</small>
          <div className="pager">
            <button className="icon-btn" disabled={current <= 1} onClick={() => setPage(current - 1)} aria-label="Trang trước"><Icon name="arrowRight" size={14} className="flip" /></button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
              <button key={p} className={p === current ? 'active' : ''} onClick={() => setPage(p)}>{p}</button>
            ))}
            <button className="icon-btn" disabled={current >= pages} onClick={() => setPage(current + 1)} aria-label="Trang sau"><Icon name="arrowRight" size={14} /></button>
          </div>
        </div>
      </section>

      <div className="panel collection-note">
        <div>
          <b>Quy định thu phí quá hạn</b>
          <p className="muted">Sau 24 giờ kể từ 20:00 ngày hết hạn, kho tự khóa và tính phí mỗi ngày = phí tháng / 30, cấn trừ vào tiền cọc. Phần vượt cọc lập hóa đơn khi trả kho.</p>
        </div>
        <Link to="/staff-return" className="btn outline"><Icon name="door" size={15} /> Mở kiểm tra trả kho</Link>
      </div>
    </div>
  )
}
