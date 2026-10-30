import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api, billingLink, fmtDate, fmtMoney } from '../api'
import { useStaffFacility } from '../components/layout'
import { Empty, Icon, StatusBadge } from '../components/ui'
import { ExtraChargeFees, type Contract, type ExtraChargeInvoice } from '../types'
import { Select } from '../components/Select'

/**
 * Contracts of the facility (GET /api/facilities/{id}/contracts?status) and billing an extra charge on one
 * (POST /api/facility-management/facilities/{id}/contracts/{contractId}/extra-charges): lost key, cleaning, ...
 * The invoice then shows in the customer's invoices and is collected at "Hóa Đơn & Thu Tiền".
 */

const STATUSES = [
  { value: '', label: 'Tất cả' },
  { value: 'Active', label: 'Đang hiệu lực' },
  { value: 'Overdue', label: 'Quá hạn' },
  { value: 'Renewed', label: 'Đã gia hạn' },
  { value: 'Terminated', label: 'Đã chấm dứt' },
  { value: 'Liquidated', label: 'Đã thanh lý' },
]
const pad = (n: number) => String(n).padStart(2, '0')
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

export default function FacilityContracts() {
  const { facilityId } = useStaffFacility()
  const [status, setStatus] = useState('')
  const location = useLocation()
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('q') ?? '')
  const [contracts, setContracts] = useState<Contract[]>([])
  const [chargeFor, setChargeFor] = useState<number | null>(null)
  const [created, setCreated] = useState<ExtraChargeInvoice[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!facilityId) return
    try {
      setContracts(await api<Contract[]>(`/api/facilities/${facilityId}/contracts${status ? `?status=${status}` : ''}`))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [facilityId, status])
  useEffect(() => { void load() }, [load])

  const shown = contracts.filter((c) => !q.trim() || `${c.contractNumber} ${c.unitCode}`.toLowerCase().includes(q.trim().toLowerCase()))
  const total = created.reduce((n, x) => n + x.totalAmount, 0)

  return (
    <div className="stack-xl">
      <div className="page-title-row">
        <h1>Hợp Đồng & Phụ Thu</h1>
        <p className="muted">Danh sách hợp đồng tại cơ sở. Lập phụ thu khi khách làm mất chìa khóa, thẻ từ, cần vệ sinh hoặc thay ổ khóa.</p>
      </div>

      <div className="panel filter-bar">
        <div className="filter-controls">
          <span className="input-wrap grow-2">
            <Icon name="search" size={16} className="input-lead" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã hợp đồng, mã kho…" />
          </span>
          <div className="segmented" role="tablist">
            {STATUSES.map((s) => (
              <button key={s.value} className={status === s.value ? 'active' : ''} onClick={() => setStatus(s.value)}>{s.label}</button>
            ))}
          </div>
        </div>
      </div>

      {created.length > 0 && (
        <p className="alert ok"><Icon name="check" size={16} />
          Đã lập {created.length} hóa đơn phụ thu ({created.map((x) => x.invoiceNumber).join(', ')}), tổng {fmtMoney(total)}. Khách thấy ở mục Thanh Toán.
          {created.length === 1 && <> <Link to={billingLink(created[0].invoiceNumber)} className="link">Thu tiền ngay</Link></>}
        </p>
      )}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Mã HĐ</th><th>Kho</th><th>Thời hạn</th><th>Giá thuê</th><th>Trạng thái</th><th className="right">Thao tác</th></tr></thead>
            <tbody>
              {shown.map((c) => {
                const billable = c.status === 'Active' || c.status === 'Overdue'
                return (
                  <Fragment key={c.contractId}>
                    <tr>
                      <td className="code">{c.contractNumber}</td>
                      <td><b>{c.unitCode}</b></td>
                      <td>{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</td>
                      <td className="money">{fmtMoney(c.monthlyRentFee)}<small className="muted">/tháng</small></td>
                      <td><StatusBadge status={c.status} /></td>
                      <td className="right">
                        <span className="row end">
                          {billable && <button className="btn outline sm" onClick={() => setChargeFor(chargeFor === c.contractId ? null : c.contractId)}><Icon name="plus" size={14} /> Lập phụ thu</button>}
                          <Link to={billingLink(c.contractNumber)} className="btn ghost sm"><Icon name="wallet" size={14} /> Hóa đơn</Link>
                        </span>
                      </td>
                    </tr>
                    {chargeFor === c.contractId && (
                      <tr className="sub-row">
                        <td colSpan={6}>
                          <ChargeForm contract={c} facilityId={facilityId!}
                            onDone={(x) => { setChargeFor(null); if (x) setCreated((list) => [x, ...list]) }} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {shown.length === 0 && <Empty icon="clipboard">Không có hợp đồng nào.</Empty>}
        </div>
        <small className="muted">Chỉ lập phụ thu cho hợp đồng đang hiệu lực hoặc quá hạn. Đơn giá theo bảng phí hiện hành.</small>
      </section>
    </div>
  )
}

function ChargeForm({ contract: c, facilityId, onDone }: { contract: Contract; facilityId: number; onDone: (x: ExtraChargeInvoice | null) => void }) {
  const [feeTypeId, setFeeTypeId] = useState(ExtraChargeFees[1].feeTypeId)
  const [quantity, setQuantity] = useState(1)
  const [dueDate, setDueDate] = useState(todayIso)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fee = ExtraChargeFees.find((f) => f.feeTypeId === feeTypeId)!

  const submit = async () => {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 365) return setError('Số lượng từ 1 đến 365')
    if (dueDate && dueDate < todayIso()) return setError('Hạn thanh toán không được ở quá khứ')
    if (notes.trim().length > 255) return setError('Ghi chú tối đa 255 ký tự')
    setError('')
    setBusy(true)
    try {
      onDone(await api<ExtraChargeInvoice>(`/api/facility-management/facilities/${facilityId}/contracts/${c.contractId}/extra-charges`, {
        body: { feeTypeId, quantity, notes: notes.trim() || null, dueDate },
      }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="charge-form">
      <b>Phụ thu cho hợp đồng {c.contractNumber} · kho {c.unitCode}</b>
      <div className="form-grid four">
        <label className="field"><span>Loại phí</span>
          <Select value={feeTypeId} onChange={(e) => setFeeTypeId(Number(e.target.value))}>
            {ExtraChargeFees.map((f) => <option key={f.feeTypeId} value={f.feeTypeId}>{f.feeName}</option>)}
          </Select>
        </label>
        <label className="field"><span>{fee.perDay ? 'Số ngày' : 'Số lượng'}</span>
          <input type="number" min={1} max={365} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} />
        </label>
        <label className="field"><span>Hạn thanh toán</span>
          <input type="date" min={todayIso()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label className="field"><span>Ghi chú</span>
          <input value={notes} maxLength={255} onChange={(e) => setNotes(e.target.value)} placeholder="vd: mất 1 chìa khóa" />
        </label>
      </div>
      <div className="row between wrap">
        <span className="muted">Dự kiến: {fmtMoney(fee.defaultAmount)} × {quantity} = <b>{fmtMoney(fee.defaultAmount * quantity)}</b> (theo bảng phí chuẩn, hệ thống tính lại khi lập)</span>
        <span className="row">
          <button type="button" className="btn ghost sm" onClick={() => onDone(null)}>Hủy</button>
          <button type="button" className="btn primary sm" disabled={busy} onClick={submit}>{busy ? 'Đang lập…' : 'Lập hóa đơn phụ thu'}</button>
        </span>
      </div>
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
    </div>
  )
}
