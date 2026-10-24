import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { useAuth } from '../auth'
import { AppointmentPicker } from '../components/appointment'
import { INVOICE_TYPE, MomoQrPanel, PAY_METHOD, PAY_STATUS, PayButtons, SandboxPayButton, TYPE_ICON, moneyInWords, useCheckout } from '../components/checkout'
import { Icon, StatusBadge } from '../components/ui'
import type { ContractDetail, Facility, Invoice, Reservation } from '../types'

/**
 * One invoice in full (GET /api/invoices/{id}): who issued it and to whom, the contract or reservation and unit it bills,
 * the line items with the total in words, what has been paid and what is left, the payment history and online payment.
 * Contract / reservation / facility come from the customer's own endpoints; the page still works if they fail.
 */

const DAY = 86400000
const asLocal = (iso: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso)

const NOTES: Record<string, string[]> = {
  DEPOSIT: [
    'Tiền cọc được giữ suốt thời hạn hợp đồng và hoàn lại khi trả kho, sau khi đối soát phí phát sinh.',
    'Đơn giữ chỗ hết hiệu lực nếu chưa thanh toán cọc trước hạn giữ chỗ.',
    'Hủy đơn đã đặt cọc: hoàn cọc sau khi trừ phí hủy theo chính sách thuê của cơ sở.',
  ],
  MONTHLY_RENT: [
    'Tiền thuê thanh toán trước cho từng kỳ một tháng.',
    'Quá hạn, kho có thể bị khóa và tính phí mỗi ngày bằng phí tháng / 30, cấn trừ vào tiền cọc.',
  ],
  RENEWAL: ['Thời hạn hợp đồng được kéo dài sau khi hóa đơn gia hạn được thanh toán.'],
  OVERDUE_FINE: ['Phí quá hạn là phần vượt quá tiền cọc khi trả kho trễ hạn (phí mỗi ngày = phí tháng / 30).'],
  EXTRA_CHARGE: ['Phụ phí theo bảng phí hiện hành của cơ sở (mất chìa khóa, thẻ từ, vệ sinh, thay ổ khóa…).'],
}

export default function InvoiceDetail() {
  const id = Number(useParams().id)
  const { user } = useAuth()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [contract, setContract] = useState<ContractDetail | null>(null)
  const [reservation, setReservation] = useState<Reservation | null>(null)
  const [facility, setFacility] = useState<Facility | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const { startingInvoiceId, momo, setMomo, startCheckout } = useCheckout(setError)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const inv = await api<Invoice>(`/api/invoices/${id}`)
      setInvoice(inv)
      setError('')
      const facilities = api<Facility[]>('/api/facilities').catch(() => [] as Facility[])
      if (inv.contractId) {
        void api<ContractDetail>(`/api/contracts/${inv.contractId}`).then(async (c) => {
          setContract(c)
          setFacility((await facilities).find((f) => f.facilityId === c.facilityId) ?? null)
        }).catch(() => {})
      }
      if (inv.reservationId) {
        void api<Reservation[]>('/api/reservations/my').then(async (rs) => {
          const r = rs.find((x) => x.reservationId === inv.reservationId) ?? null
          setReservation(r)
          if (r && !inv.contractId) setFacility((await facilities).find((f) => f.facilityName === r.facilityName) ?? null)
        }).catch(() => {})
      }
    } catch (e) {
      if (!quiet) setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id])
  useEffect(() => { void load() }, [load])
  // The gateway confirms on its own: while unpaid, check every 10 seconds so the status changes by itself.
  const unpaid = invoice?.status === 'Unpaid' || invoice?.status === 'Overdue'
  useEffect(() => {
    if (!unpaid) return
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(true) }, 10000)
    return () => window.clearInterval(t)
  }, [unpaid, load])
  const onSandboxPaid = () => { setMomo(null); void load(true) }

  if (!invoice) {
    return (
      <div className="container page-body">
        {error ? <p className="alert bad"><Icon name="alert" size={16} />{error}</p> : <p className="muted">Đang tải hóa đơn…</p>}
        <Link to="/invoices" className="link">← Về danh sách hóa đơn</Link>
      </div>
    )
  }

  const payable = invoice.status === 'Unpaid' || invoice.status === 'Overdue'
  const paid = invoice.payments.filter((p) => p.status === 'Success').reduce((n, p) => n + p.amountPaid, 0)
  const refunded = invoice.payments.filter((p) => p.status === 'Refunded').reduce((n, p) => n + p.amountPaid, 0)
  const remaining = Math.max(0, invoice.status === 'Paid' ? 0 : invoice.totalAmount - paid)
  const pct = invoice.totalAmount > 0 ? Math.min(100, Math.round((invoice.totalAmount - remaining) / invoice.totalAmount * 100)) : 100
  const daysLeft = Math.ceil((asLocal(invoice.dueDate).getTime() - new Date().setHours(0, 0, 0, 0)) / DAY)
  const typeName = INVOICE_TYPE[invoice.invoiceType] ?? invoice.invoiceType
  const period = invoice.billingPeriodStart && invoice.billingPeriodEnd ? `${fmtDate(invoice.billingPeriodStart)} – ${fmtDate(invoice.billingPeriodEnd)}` : null
  const facilityName = contract?.facilityName ?? reservation?.facilityName ?? facility?.facilityName
  const unitCode = contract?.unitCode ?? reservation?.assignedUnitCode

  const events = [
    { key: 'c', at: invoice.createdAt, icon: 'file', tone: 'info', title: 'Lập hóa đơn', note: `${invoice.invoiceNumber} · ${fmtMoney(invoice.totalAmount)}` },
    ...invoice.payments.map((p) => ({
      key: `p${p.paymentId}`, at: p.paymentDate, icon: p.status === 'Refunded' ? 'refresh' : 'wallet', tone: PAY_STATUS[p.status]?.tone ?? 'muted',
      title: `${p.status === 'Refunded' ? 'Hoàn tiền' : 'Thanh toán'} ${PAY_METHOD[p.paymentMethod] ?? p.paymentMethod} · ${PAY_STATUS[p.status]?.label ?? p.status}`,
      note: [fmtMoney(p.amountPaid), p.transactionCode && `mã GD ${p.transactionCode}`, p.receivedByStaff && `NV ${p.receivedByStaff}`, p.paymentNotes].filter(Boolean).join(' · '),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  return (
    <>
      <section className="page-hero detail-hero">
        <div className="container">
          <div className="grow">
            <nav className="crumbs"><Link to="/invoices">Hóa Đơn & Thanh Toán</Link><span>/</span><b>{invoice.invoiceNumber}</b></nav>
            <h1>{typeName}{period && <span className="hero-sub"> · kỳ {period}</span>}</h1>
            <div className="row wrap hero-meta">
              <StatusBadge status={invoice.status} />
              <span>Mã hóa đơn <b className="code">{invoice.invoiceNumber}</b></span>
              <span>Lập {fmtTime(invoice.createdAt)}</span>
            </div>
          </div>
          <div className="row wrap no-print">
            <button className="btn outline-light" onClick={() => window.print()}><Icon name="clipboard" size={15} /> In hóa đơn</button>
            <button className="btn outline-light" onClick={() => void load()} disabled={loading}><Icon name="refresh" size={15} /> Làm mới</button>
          </div>
        </div>
      </section>

      <div className="container page-body invoice-detail">
        {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

        <div className="invoice-detail-grid">
          <article className="panel invoice-paper">
            <header className="paper-head">
              <div>
                <div className="paper-brand"><Icon name="shield" size={20} /> SafeKeep Storage</div>
                <small className="muted">Hệ thống kho tự phục vụ cho thuê theo tháng</small>
              </div>
              <div className="right">
                <span className="label">HÓA ĐƠN</span>
                <b className="paper-number">{invoice.invoiceNumber}</b>
                <small className="muted">Ngày lập {fmtDate(invoice.createdAt)}</small>
              </div>
            </header>

            <div className="paper-parties">
              <div>
                <span className="label">Đơn vị cung cấp</span>
                <b>{facilityName ?? 'SafeKeep Storage'}</b>
                {facility && <><span>{[facility.address, facility.district, facility.city].filter(Boolean).join(', ')}</span><small className="muted">Hotline {facility.hotline} · {facility.operatingHours}</small></>}
              </div>
              <div>
                <span className="label">Khách hàng</span>
                <b>{reservation?.customerName ?? user?.fullName}</b>
                {user && <small className="muted">Tài khoản {user.username}</small>}
              </div>
            </div>

            <dl className="paper-meta">
              <div><dt>Loại hóa đơn</dt><dd><span className={`invoice-icon sm t-${invoice.invoiceType.toLowerCase()}`}><Icon name={TYPE_ICON[invoice.invoiceType] ?? 'file'} size={13} /></span>{typeName}</dd></div>
              {invoice.contractId && <div><dt>Hợp đồng</dt><dd>{contract ? <Link className="link" to={`/my-units/${invoice.contractId}`}>{contract.contractNumber}</Link> : `#${invoice.contractId}`}</dd></div>}
              {invoice.reservationId && <div><dt>Đơn giữ chỗ</dt><dd>{reservation?.reservationCode ?? `#${invoice.reservationId}`}</dd></div>}
              {unitCode && <div><dt>Kho</dt><dd><b>{unitCode}</b>{reservation && <small className="muted"> · {reservation.unitTypeName}</small>}</dd></div>}
              {!unitCode && reservation && <div><dt>Loại kho</dt><dd>{reservation.unitTypeName}</dd></div>}
              {period && <div><dt>Kỳ thanh toán</dt><dd>{period}</dd></div>}
              {contract && <div><dt>Thời hạn hợp đồng</dt><dd>{fmtDate(contract.startDate)} – {fmtDate(contract.endDate)}</dd></div>}
              {reservation && !contract && <div><dt>Ngày bắt đầu thuê</dt><dd>{fmtDate(reservation.expectedStartDate)} · {reservation.durationMonths} tháng</dd></div>}
              <div><dt>Hạn thanh toán</dt><dd className={invoice.status === 'Overdue' ? 'danger-text' : ''}>{fmtDate(invoice.dueDate)}</dd></div>
            </dl>

            <div className="table-scroll">
              <table className="paper-lines">
                <thead><tr><th>#</th><th>Nội dung</th><th className="right">SL</th><th className="right">Đơn giá</th><th className="right">Thành tiền</th></tr></thead>
                <tbody>
                  {invoice.details.map((d, i) => (
                    <tr key={d.detailId}><td className="muted">{i + 1}</td><td>{d.description}</td><td className="right">{d.quantity}</td><td className="right">{fmtMoney(d.unitPrice)}</td><td className="right">{fmtMoney(d.lineTotal)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="paper-totals">
              <div><span>Tạm tính</span><span>{fmtMoney(invoice.subTotal)}</span></div>
              {invoice.discountAmount > 0 && <div><span>Giảm giá{reservation?.promoCode && <> · mã <span className="code">{reservation.promoCode}</span></>}</span><span className="ok-text">−{fmtMoney(invoice.discountAmount)}</span></div>}
              <div className="grand"><span>Tổng cộng</span><span>{fmtMoney(invoice.totalAmount)}</span></div>
              <small className="muted words">Bằng chữ: {moneyInWords(invoice.totalAmount)}.</small>
            </div>

            {NOTES[invoice.invoiceType] && (
              <div className="paper-notes">
                <span className="label">Ghi chú</span>
                <ul>{NOTES[invoice.invoiceType].map((n) => <li key={n}>{n}</li>)}</ul>
                <small className="muted">Chi tiết xem <Link className="link" to="/terms">Điều khoản hợp đồng</Link>.</small>
              </div>
            )}
          </article>

          <aside className="stack-lg">
            <section className={`panel pay-summary ${invoice.status === 'Overdue' ? 'overdue' : payable ? 'due' : 'done'}`}>
              <span className="label">{payable ? 'Còn phải thanh toán' : 'Tình trạng'}</span>
              <b className="pay-big">{payable ? fmtMoney(remaining) : invoice.status === 'Paid' ? 'Đã thanh toán đủ' : <StatusBadge status={invoice.status} />}</b>
              {payable && <small className={daysLeft < 0 ? 'danger-text' : daysLeft <= 3 ? 'warn-text' : 'muted'}>
                {daysLeft < 0 ? `Quá hạn ${-daysLeft} ngày (hạn ${fmtDate(invoice.dueDate)})` : daysLeft === 0 ? 'Đến hạn hôm nay' : `Còn ${daysLeft} ngày · hạn ${fmtDate(invoice.dueDate)}`}
              </small>}
              <div className="pay-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Đã thanh toán"><i style={{ width: `${pct}%` }} /></div>
              <dl className="pay-lines">
                <div><dt>Tổng hóa đơn</dt><dd>{fmtMoney(invoice.totalAmount)}</dd></div>
                <div><dt>Đã thanh toán</dt><dd className="ok-text">{fmtMoney(invoice.status === 'Paid' ? Math.max(paid, invoice.totalAmount) : paid)}</dd></div>
                {refunded > 0 && <div><dt>Đã hoàn lại</dt><dd>{fmtMoney(refunded)}</dd></div>}
                <div><dt>Còn lại</dt><dd><b>{fmtMoney(remaining)}</b></dd></div>
              </dl>
              {payable && (momo?.invoiceId === invoice.invoiceId
                ? <><MomoQrPanel invoiceNumber={invoice.invoiceNumber} checkout={momo.checkout} onPaid={() => { setMomo(null); void load() }} onClose={() => setMomo(null)} />
                    <SandboxPayButton invoiceId={invoice.invoiceId} provider="momo" onPaid={onSandboxPaid} onError={setError} /></>
                : <>
                    <PayButtons invoiceId={invoice.invoiceId} startingInvoiceId={startingInvoiceId} startCheckout={(i, p) => void startCheckout(i, p)} />
                    <SandboxPayButton invoiceId={invoice.invoiceId} onPaid={onSandboxPaid} onError={setError} />
                    <small className="muted">Hoặc thanh toán tiền mặt / chuyển khoản tại quầy{facilityName ? ` cơ sở ${facilityName}` : ''}, đọc mã <b className="code">{invoice.invoiceNumber}</b> cho nhân viên.</small>
                  </>)}
            </section>

            {reservation?.status === 'Confirmed' && invoice.invoiceType === 'DEPOSIT' && (
              <section className="panel handover-panel">
                <span className="handover-icon"><Icon name="package" size={20} /></span>
                <h3 className="panel-title">Chờ bàn giao kho</h3>
                <small className="muted">Đơn {reservation.reservationCode} · nhận kho ngày <b>{fmtDate(reservation.expectedStartDate)}</b> tại {reservation.facilityName}. {reservation.checkInAppointmentAt ? 'Nhớ mang CCCD khi đến.' : 'Chọn giờ đến để nhân viên chuẩn bị bàn giao.'}</small>
                <AppointmentPicker reservation={reservation} operatingHours={facility?.operatingHours} defaultOpen onSaved={setReservation} />
              </section>
            )}

            <section className="panel">
              <h3 className="panel-title">Lịch sử hóa đơn</h3>
              <ol className="inv-timeline">
                {events.map((e) => (
                  <li key={e.key} className={`tl-${e.tone}`}>
                    <span className="tl-dot"><Icon name={e.icon} size={13} /></span>
                    <div><b>{e.title}</b><small className="muted">{fmtTime(e.at)}</small>{e.note && <small>{e.note}</small>}</div>
                  </li>
                ))}
                {payable && (
                  <li className={invoice.status === 'Overdue' ? 'tl-bad' : 'tl-warn'}>
                    <span className="tl-dot"><Icon name="calendar" size={13} /></span>
                    <div><b>{invoice.status === 'Overdue' ? 'Đã quá hạn thanh toán' : 'Chờ thanh toán'}</b><small className="muted">Hạn {fmtDate(invoice.dueDate)}</small></div>
                  </li>
                )}
              </ol>
            </section>

            {(contract || reservation) && (
              <section className="panel stack-sm">
                <h3 className="panel-title">Liên quan</h3>
                {contract && <Link className="related-link" to={`/my-units/${contract.contractId}`}><Icon name="package" size={16} /><span className="grow"><b>Kho {contract.unitCode}</b><small className="muted">Hợp đồng {contract.contractNumber} · {fmtMoney(contract.monthlyRentFee)}/tháng</small></span><Icon name="arrowRight" size={14} /></Link>}
                {reservation && <Link className="related-link" to="/rent"><Icon name="calendar" size={16} /><span className="grow"><b>Đơn {reservation.reservationCode}</b><small className="muted">{reservation.unitTypeName} · {reservation.durationMonths} tháng · <StatusBadge status={reservation.status} /></small></span><Icon name="arrowRight" size={14} /></Link>}
                <Link className="related-link" to="/support"><Icon name="mail" size={16} /><span className="grow"><b>Thắc mắc về hóa đơn?</b><small className="muted">Gửi yêu cầu hỗ trợ kèm mã {invoice.invoiceNumber}</small></span><Icon name="arrowRight" size={14} /></Link>
              </section>
            )}
          </aside>
        </div>
      </div>
    </>
  )
}
