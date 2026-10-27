import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney } from '../api'
import { Icon } from '../components/ui'
import { Roles, type AdminUser, type OperationsReport } from '../types'
import { localToday } from '../validation'
import { Metric } from './FacilityOverview'

/**
 * Extra panels for the administrator's "Tổng Quan" (shown under ConsoleOverview): accounts,
 * each facility's last 30 days (GET /api/operations/reports/facilities) and shortcuts to every admin screen.
 * GET /api/admin/users.
 */
export function AdminSystemPanels() {
  const [report, setReport] = useState<OperationsReport | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])

  useEffect(() => {
    api<OperationsReport>(`/api/operations/reports/facilities?fromDate=${localToday(-29)}&toDate=${localToday()}`).then(setReport).catch(() => {})
    api<AdminUser[]>('/api/admin/users').then(setUsers).catch(() => {})
  }, [])

  const customers = users.filter((u) => u.roleName === Roles.Customer)
  const staff = users.filter((u) => u.roleName !== Roles.Customer)

  return (
    <>
      <div className="stat-grid three">
        <Metric icon="users" tone="info" label="Tài khoản khách" value={String(customers.length)} note={`${customers.filter((u) => u.status !== 'Active').length} tài khoản bị khóa`} />
        <Metric icon="user" tone="info" label="Tài khoản nhân viên" value={String(staff.length)} note={`${staff.filter((u) => u.roleName === Roles.Staff).length} nhân viên cơ sở`} />
        <Metric icon="alert" tone={report?.openSupportRequests ? 'warn' : 'ok'} label="Yêu cầu hỗ trợ mở" value={String(report?.openSupportRequests ?? 0)} note={`${report?.maintenanceUnits ?? 0} kho bảo trì · ${report?.overdueLockedUnits ?? 0} kho khóa`} />
      </div>

      <section className="panel">
        <div className="panel-head wrap"><h2 className="panel-title">Theo cơ sở · 30 ngày gần nhất</h2><Link to="/admin/units" className="link">Xem kho từng cơ sở →</Link></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Cơ sở</th><th className="right">Kho</th><th className="right">Đang thuê</th><th className="right">Trống</th><th className="right">Bảo trì / khóa</th><th className="right">Hợp đồng</th><th className="right">Hỗ trợ mở</th><th className="right">Doanh thu</th></tr></thead>
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

      <div>
        <section className="panel stack-sm">
          <h2 className="panel-title">Lối tắt quản trị</h2>
          {[
            ['/admin/units', 'building', 'Kho từng cơ sở', 'Mọi kho và trạng thái'],
            ['/admin/facilities', 'grid', 'Quản lý cơ sở', 'Thêm, sửa, tạm đóng cơ sở'],
            ['/admin/policies', 'clipboard', 'Giá & chính sách', 'Giá thuê, chính sách, phí, khuyến mãi'],
            ['/admin/users', 'user', 'Nhân viên', 'Tài khoản, vai trò, phân công'],
          ].map(([to, icon, title, text]) => (
            <Link key={to} to={to} className="related-link"><Icon name={icon} size={18} /><span className="grow"><b>{title}</b><small className="muted">{text}</small></span><Icon name="arrowRight" size={14} /></Link>
          ))}
        </section>
      </div>
    </>
  )
}
