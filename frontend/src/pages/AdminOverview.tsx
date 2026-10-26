import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney, fmtTime } from '../api'
import { Icon } from '../components/ui'
import { Roles, type AdminContract, type AdminUser, type EmailOutboxMessage, type OperationsReport } from '../types'
import { localToday } from '../validation'
import { Metric } from './FacilityOverview'

/**
 * System administrator: the whole system at a glance. Facilities and units (GET /api/operations/reports/facilities,
 * last 30 days), accounts (GET /api/admin/users), contracts (GET /api/admin/contracts) and emails that failed to send
 * (GET /api/admin/email-outbox?status=Failed), with links to each management screen.
 */
export default function AdminOverview() {
  const [report, setReport] = useState<OperationsReport | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [contracts, setContracts] = useState<AdminContract[]>([])
  const [failed, setFailed] = useState<EmailOutboxMessage[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api<OperationsReport>(`/api/operations/reports/facilities?fromDate=${localToday(-29)}&toDate=${localToday()}`).then(setReport).catch((e) => setError((e as Error).message))
    api<AdminUser[]>('/api/admin/users').then(setUsers).catch(() => {})
    api<AdminContract[]>('/api/admin/contracts?pageSize=100').then(setContracts).catch(() => {})
    api<EmailOutboxMessage[]>('/api/admin/email-outbox?status=Failed&pageSize=50').then(setFailed).catch(() => {})
  }, [])

  const customers = users.filter((u) => u.roleName === Roles.Customer)
  const staff = users.filter((u) => u.roleName !== Roles.Customer)
  const occupancy = report && report.totalUnits ? Math.round(report.rentedUnits / report.totalUnits * 100) : 0
  const endingSoon = contracts.filter((c) => c.status === 'Active' && c.endDate <= localToday(14)).length

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Tổng Quan Hệ Thống</h1>
          <p className="muted">Toàn bộ cơ sở, kho, hợp đồng, tài khoản và doanh thu 30 ngày gần nhất.</p>
        </div>
        <Link to="/admin/revenue" className="btn outline"><Icon name="chart" size={15} /> Báo cáo doanh thu</Link>
      </div>
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <div className="stat-grid four">
        <Metric icon="building" tone="info" label="Cơ sở" value={String(report?.facilityCount ?? '—')} note={`${report?.totalUnits ?? 0} kho lưu trữ`} />
        <Metric icon="package" tone="ok" label="Tỷ lệ lấp đầy" value={`${occupancy}%`} note={`${report?.rentedUnits ?? 0} đang thuê · ${report?.availableUnits ?? 0} trống`} />
        <Metric icon="wallet" tone="ok" label="Doanh thu 30 ngày" value={fmtMoney(report?.netRevenue ?? 0)} note="đã trừ hoàn tiền" />
        <Metric icon="file" tone={report?.overdueContracts ? 'bad' : 'info'} label="Hợp đồng hiệu lực" value={String(report?.activeContracts ?? '—')} note={`${report?.overdueContracts ?? 0} quá hạn · ${endingSoon} hết hạn trong 14 ngày`} />
        <Metric icon="users" tone="info" label="Khách hàng" value={String(customers.length)} note={`${customers.filter((u) => u.status !== 'Active').length} tài khoản bị khóa`} />
        <Metric icon="user" tone="info" label="Nhân viên" value={String(staff.length)} note={`${staff.filter((u) => u.roleName === Roles.Staff).length} nhân viên cơ sở`} />
        <Metric icon="alert" tone={report?.openSupportRequests ? 'warn' : 'ok'} label="Yêu cầu hỗ trợ mở" value={String(report?.openSupportRequests ?? 0)} note={`${report?.maintenanceUnits ?? 0} kho bảo trì · ${report?.overdueLockedUnits ?? 0} kho khóa`} />
        <Metric icon="mail" tone={failed.length ? 'bad' : 'ok'} label="Email gửi lỗi" value={String(failed.length)} note={failed.length ? 'cần gửi lại' : 'không có thư lỗi'} />
      </div>

      <section className="panel">
        <div className="panel-head wrap"><h2 className="panel-title">Theo cơ sở</h2><Link to="/admin/units" className="link">Xem kho từng cơ sở →</Link></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Cơ sở</th><th className="right">Kho</th><th className="right">Đang thuê</th><th className="right">Trống</th><th className="right">Bảo trì / khóa</th><th className="right">Hợp đồng</th><th className="right">Hỗ trợ mở</th><th className="right">Doanh thu 30 ngày</th></tr></thead>
            <tbody>
              {report?.facilities.map((f) => (
                <tr key={f.facilityId}>
                  <td><Link to={`/admin/units?facility=${f.facilityId}`} className="link">{f.facilityName}</Link></td>
                  <td className="right">{f.totalUnits}</td>
                  <td className="right">{f.rentedUnits} <small className="muted">({f.totalUnits ? Math.round(f.rentedUnits / f.totalUnits * 100) : 0}%)</small></td>
                  <td className="right">{f.availableUnits}</td>
                  <td className="right">{f.maintenanceUnits} / {f.overdueLockedUnits}</td>
                  <td className="right">{f.activeContracts}{f.overdueContracts > 0 && <small className="danger-text"> · {f.overdueContracts} quá hạn</small>}</td>
                  <td className="right">{f.openSupportRequests}</td>
                  <td className="right money">{fmtMoney(f.netRevenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="split-two">
        <section className="panel stack-sm">
          <div className="panel-head"><h2 className="panel-title">Hợp đồng sắp hết hạn</h2><Link to="/admin/contracts" className="link">Tất cả →</Link></div>
          {contracts.filter((c) => c.status === 'Active' && c.endDate <= localToday(14)).slice(0, 6).map((c) => (
            <div key={c.contractId} className="info-row"><span><b>{c.contractNumber}</b> <small className="muted">· {c.customerName} · {c.unitCode} · {c.facilityName}</small></span><b className="warn-text">{c.endDate.split('-').reverse().join('/')}</b></div>
          ))}
          {endingSoon === 0 && <p className="muted">Không có hợp đồng hết hạn trong 14 ngày tới.</p>}
        </section>
        <section className="panel stack-sm">
          <div className="panel-head"><h2 className="panel-title">Email gửi lỗi</h2><Link to="/admin/emails" className="link">Xử lý →</Link></div>
          {failed.slice(0, 6).map((m) => (
            <div key={m.emailOutboxMessageId} className="info-row"><span><b>{m.recipientEmail}</b> <small className="muted">· {m.subject}</small></span><small className="muted">{fmtTime(m.createdAt)}</small></div>
          ))}
          {failed.length === 0 && <p className="muted">Không có thư gửi lỗi.</p>}
        </section>
      </div>

      <section className="panel">
        <h2 className="panel-title">Lối tắt quản trị</h2>
        <div className="shortcut-grid">
          {[
            ['/admin/units', 'building', 'Kho lưu trữ', 'Mọi kho của từng cơ sở và trạng thái'],
            ['/admin/facilities', 'grid', 'Quản lý cơ sở', 'Thêm, sửa, tạm đóng cơ sở'],
            ['/admin/customers', 'users', 'Khách hàng', 'Tài khoản và hợp đồng của khách'],
            ['/admin/users', 'user', 'Nhân viên', 'Tài khoản, vai trò, phân công'],
            ['/admin/contracts', 'file', 'Hợp đồng', 'Tra cứu, sửa, trả kho'],
            ['/admin/settings', 'settings', 'Cài đặt', 'Giá, chính sách thuê, phí, khuyến mãi'],
          ].map(([to, icon, title, text]) => (
            <Link key={to} to={to} className="related-link"><Icon name={icon} size={18} /><span className="grow"><b>{title}</b><small className="muted">{text}</small></span><Icon name="arrowRight" size={14} /></Link>
          ))}
        </div>
      </section>
    </div>
  )
}
