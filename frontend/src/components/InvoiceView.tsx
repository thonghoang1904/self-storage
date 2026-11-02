import { fmtDate, fmtMoney } from '../api'
import type { Invoice } from '../types'
import { StatusBadge } from './ui'

const INVOICE_TYPE: Record<string, string> = {
  DEPOSIT: 'Tiền cọc', RENEWAL: 'Gia hạn', MONTHLY_RENT: 'Tiền thuê', OVERDUE_FINE: 'Phí quá hạn', EXTRA_CHARGE: 'Phụ phí',
}
const PAY_STATE: Record<string, [string, string]> = {
  Success: ['Thành công', 'ok'], Pending: ['Đang chờ', 'warn'], Failed: ['Thất bại', 'bad'], Refunded: ['Đã hoàn', 'info'],
  Reversed: ['Đã hoàn trả', 'info'], RefundDue: ['Chờ hoàn tiền', 'warn'],
}
const METHOD: Record<string, string> = { Cash: 'Tiền mặt', BankTransfer: 'Chuyển khoản', VNPay: 'VNPay', MoMo: 'MoMo' }

/** One invoice: lines, totals and payments (from the facility invoice list, nothing more to load). */
export function InvoiceView({ invoice: i, customer, target }: { invoice: Invoice; customer?: string; target?: string }) {
  return (
    <>
      <div className="row between wrap"><StatusBadge status={i.status} /><small className="muted">{INVOICE_TYPE[i.invoiceType] ?? i.invoiceType}</small></div>
      <div className="form-grid two">
        <div className="info-box">
          <div className="info-row"><span className="muted">Khách hàng</span><b>{customer ?? '…'}</b></div>
          {target && <div className="info-row"><span className="muted">Thuộc</span><b>{target}</b></div>}
        </div>
        <div className="info-box">
          <div className="info-row"><span className="muted">Ngày lập</span><b>{fmtDate(i.createdAt)}</b></div>
          <div className="info-row"><span className="muted">Hạn thanh toán</span><b>{fmtDate(i.dueDate)}</b></div>
          {i.billingPeriodStart && i.billingPeriodEnd && <div className="info-row"><span className="muted">Kỳ thuê</span><b>{fmtDate(i.billingPeriodStart)} – {fmtDate(i.billingPeriodEnd)}</b></div>}
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Nội dung</th><th className="right">SL</th><th className="right">Đơn giá</th><th className="right">Thành tiền</th></tr></thead>
          <tbody>
            {i.details.map((d) => (
              <tr key={d.detailId}><td>{d.description}</td><td className="right">{d.quantity}</td><td className="right">{fmtMoney(d.unitPrice)}</td><td className="right money">{fmtMoney(d.lineTotal)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="info-box">
        <div className="info-row"><span className="muted">Tạm tính</span><b>{fmtMoney(i.subTotal)}</b></div>
        {i.discountAmount > 0 && <div className="info-row"><span className="muted">Giảm giá</span><b>−{fmtMoney(i.discountAmount)}</b></div>}
        <div className="info-row"><span className="muted">Tổng cộng</span><b className="money">{fmtMoney(i.totalAmount)}</b></div>
      </div>
      <div className="stack-sm">
        <b>Thanh toán</b>
        {i.payments.length === 0 ? <p className="muted">Chưa có giao dịch thanh toán.</p> : i.payments.map((p) => (
          <div key={p.paymentId} className="info-row">
            <span><b>{fmtMoney(p.amountPaid)}</b> · {METHOD[p.paymentMethod] ?? p.paymentMethod}{p.transactionCode ? ` · ${p.transactionCode}` : ''}<br />
              <small className="muted">{fmtDate(p.paymentDate)}{p.receivedByStaff ? ` · ${p.receivedByStaff}` : ''}</small></span>
            <span className={`badge ${PAY_STATE[p.status]?.[1] ?? 'muted'}`}>{PAY_STATE[p.status]?.[0] ?? p.status}</span>
          </div>
        ))}
      </div>
    </>
  )
}
