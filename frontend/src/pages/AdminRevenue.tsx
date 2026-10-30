import { useEffect, useMemo, useState } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { Empty, Icon } from '../components/ui'
import type { AdminContract, OperationsReportRow } from '../types'

/**
 * Admin "Doanh Thu & Thống Kê" (Figma "revenue-analytics"), built only from data the API has:
 * - payments (GET /api/admin/payments, paged): money received (Success, not deposit offsets) and money paid back
 *   (Refunded), per month over the last 12 months, the same figures as the reports and the admin dashboard. A Reversed
 *   payment (online money returned because the invoice could no longer take it) was never counted as received, so it
 *   is not a refund either. The system records no operating costs, so the second line is refunds, not expenses;
 * - revenue by unit type (GET /api/operations/reports/details, this year);
 * - top paying customers this year, with their units and rented months (GET /api/admin/contracts).
 */

interface Pay { customerId: number; customerName: string; paymentMethod: string; status: string; amountPaid: number; paymentDate: string }

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthKey = (s: string) => s.slice(0, 7)
const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'] // validated categorical order (dataviz palette)
const REVENUE = '#0096b7'
const REFUND = '#e34948'
const short = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(1)} tỷ` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} tr` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)
const isIncome = (p: Pay) => p.status === 'Success' && p.paymentMethod !== 'DepositOffset'
const isRefund = (p: Pay) => p.status === 'Refunded'

async function allPayments(): Promise<Pay[]> {
  const out: Pay[] = []
  for (let page = 1; page <= 30; page++) {
    const rows = await api<Pay[]>(`/api/admin/payments?page=${page}&pageSize=100`)
    out.push(...rows)
    if (rows.length < 100) break
  }
  return out
}

export default function AdminRevenue() {
  const today = new Date()
  const yearStart = iso(new Date(today.getFullYear(), 0, 1))
  const [pays, setPays] = useState<Pay[] | null>(null)
  const [byType, setByType] = useState<OperationsReportRow[]>([])
  const [contracts, setContracts] = useState<AdminContract[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    allPayments().then(setPays).catch((e) => { setPays([]); setError((e as Error).message) })
    api<OperationsReportRow[]>(`/api/operations/reports/details?fromDate=${yearStart}&toDate=${iso(today)}`).then(setByType).catch(() => setByType([]))
    api<AdminContract[]>('/api/admin/contracts?pageSize=100').then(setContracts).catch(() => setContracts([]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Last 12 months, oldest first.
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1)
    return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: d.getMonth() === 0 ? `T1/${String(d.getFullYear()).slice(2)}` : `T${d.getMonth() + 1}` }
  }), []) // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => months.map((m) => {
    const inMonth = (pays ?? []).filter((p) => monthKey(p.paymentDate) === m.key)
    return { ...m, income: inMonth.filter(isIncome).reduce((n, p) => n + p.amountPaid, 0), refund: inMonth.filter(isRefund).reduce((n, p) => n + p.amountPaid, 0) }
  }), [pays, months])

  const year = String(today.getFullYear())
  const thisYear = (pays ?? []).filter((p) => p.paymentDate.startsWith(year))
  const incomeYtd = thisYear.filter(isIncome).reduce((n, p) => n + p.amountPaid, 0)
  const refundYtd = thisYear.filter(isRefund).reduce((n, p) => n + p.amountPaid, 0)
  const cur = series[11]
  const prev = series[10]
  const change = prev && prev.income > 0 ? ((cur.income - prev.income) / prev.income) * 100 : null

  // Revenue by unit type (this year); more than five types fold into "Khác".
  const types = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of byType) m.set(r.unitTypeName, (m.get(r.unitTypeName) ?? 0) + Math.max(0, r.netRevenue))
    const list = [...m.entries()].map(([name, value]) => ({ name: name.replace(/\s*\(.*\)$/, ''), value })).sort((a, b) => b.value - a.value)
    return list.length > 5 ? [...list.slice(0, 4), { name: 'Khác', value: list.slice(4).reduce((n, x) => n + x.value, 0) }] : list
  }, [byType])
  const typeTotal = types.reduce((n, t) => n + t.value, 0)

  // Top customers by money paid this year, net of what was paid back to them (a refunded deposit is not money kept).
  const top = useMemo(() => {
    const m = new Map<number, { name: string; paid: number }>()
    for (const p of thisYear.filter((p) => isIncome(p) || isRefund(p))) {
      const x = m.get(p.customerId) ?? { name: p.customerName, paid: 0 }
      x.paid += isRefund(p) ? -p.amountPaid : p.amountPaid
      m.set(p.customerId, x)
    }
    return [...m.entries()].filter(([, x]) => x.paid > 0).sort((a, b) => b[1].paid - a[1].paid).slice(0, 5).map(([id, x]) => {
      const own = contracts.filter((c) => c.customerId === id)
      const monthsRented = own.reduce((n, c) => n + Math.max(1, Math.round((new Date(c.endDate).getTime() - new Date(c.startDate).getTime()) / (30.44 * 86400000))), 0)
      return { id, ...x, units: own.map((c) => c.unitCode).join(', '), monthsRented }
    })
  }, [thisYear, contracts])

  const exportCsv = () => {
    const lines = [['Tháng', 'Doanh thu', 'Hoàn tiền', 'Thuần'], ...series.map((s) => [s.key, String(s.income), String(s.refund), String(s.income - s.refund)])]
    const csv = '﻿' + lines.map((l) => l.map((v) => `"${v}"`).join(',')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `doanh-thu-12-thang-${iso(today)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="stack-xl revenue-page">
      <div className="page-title-row row between wrap">
        <span className="chip-static"><Icon name="calendar" size={15} /> Thời gian: {fmtDate(yearStart)} – {fmtDate(iso(today))}</span>
        <span className="row">
          <button className="btn outline sm" onClick={exportCsv} disabled={!pays?.length}><Icon name="file" size={15} /> Xuất Excel</button>
          <button className="btn primary sm" onClick={() => window.print()}><Icon name="file" size={15} /> Xuất PDF</button>
        </span>
      </div>
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <div className="stat-grid">
        <Kpi label={`Tổng doanh thu ${year}`} value={fmtMoney(incomeYtd)} note={`Tính từ đầu năm ${year}`} />
        <Kpi label="Doanh thu tháng này" value={fmtMoney(cur?.income ?? 0)}
          badge={change === null ? undefined : { text: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`, good: change >= 0 }} note="so với tháng trước" />
        <Kpi label="Hoàn tiền cho khách" value={fmtMoney(refundYtd)} note="Hoàn cọc, hoàn tiền dư" badge={refundYtd ? { text: `${incomeYtd ? ((refundYtd / incomeYtd) * 100).toFixed(1) : 0}%`, good: false } : undefined} />
        <Kpi label="Doanh thu thuần" value={fmtMoney(incomeYtd - refundYtd)} note="Doanh thu trừ hoàn tiền" />
      </div>

      <section className="panel">
        <div className="panel-head wrap">
          <div><h2 className="panel-title">Thống Kê Thu & Hoàn Tiền</h2><small className="muted block">Lịch sử 12 tháng gần nhất</small></div>
          <span className="chart-legend"><i style={{ background: REVENUE }} /> Doanh thu <i style={{ background: REFUND }} /> Hoàn tiền</span>
        </div>
        {pays === null ? <p className="muted">Đang tải…</p> : <LineChart data={series} />}
      </section>

      <div className="split-two revenue-split">
        <section className="panel">
          <h2 className="panel-title">Doanh Thu Theo Loại Kho</h2>
          {typeTotal === 0 ? <Empty icon="chart">Chưa có doanh thu năm nay.</Empty> : (
            <div className="donut-wrap">
              <Donut parts={types.map((t, i) => ({ value: t.value, color: COLORS[i] }))} />
              <ul className="donut-legend">
                {types.map((t, i) => (
                  <li key={t.name}><i style={{ background: COLORS[i] }} /><span className="grow">{t.name}</span><b>{Math.round((t.value / typeTotal) * 100)}%</b></li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <section className="panel">
          <h2 className="panel-title">Khách Hàng Đóng Góp Hàng Đầu</h2>
          {top.length === 0 ? <Empty icon="users">Chưa có thanh toán năm nay.</Empty> : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Khách hàng</th><th>Kho thuê</th><th>Thời gian</th><th className="right">Tổng chi trả</th></tr></thead>
                <tbody>
                  {top.map((c) => (
                    <tr key={c.id}><td><b>{c.name}</b></td><td>{c.units || '—'}</td><td>{c.monthsRented ? `${c.monthsRented} tháng` : '—'}</td><td className="right money cyan">{fmtMoney(c.paid)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Kpi({ label, value, note, badge }: { label: string; value: string; note: string; badge?: { text: string; good: boolean } }) {
  return (
    <div className="stat-card">
      <div className="row between"><span className="muted">{label}</span><span className="stat-icon info"><Icon name="chart" size={17} /></span></div>
      <b className="stat-value">{value}</b>
      <small className="stat-note muted">{badge && <span className={`badge ${badge.good ? 'ok' : 'bad'}`}>{badge.text}</span>} {note}</small>
    </div>
  )
}

/** Two-line chart (one y axis, same unit); hover a month for its values. */
function LineChart({ data }: { data: { key: string; label: string; income: number; refund: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 760, H = 240, L = 56, R = 12, T = 12, B = 28
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.refund)))
  const step = Math.pow(10, Math.floor(Math.log10(max)))
  const top = Math.ceil(max / step) * step
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, data.length - 1)
  const y = (v: number) => T + (H - T - B) * (1 - v / top)
  const path = (k: 'income' | 'refund') => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ')
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * top)
  const h = hover === null ? null : data[hover]
  return (
    <div className="line-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Doanh thu và hoàn tiền 12 tháng">
        {ticks.map((t) => (
          <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 8} y={y(t) + 4} textAnchor="end" className="tick">{short(t)}</text></g>
        ))}
        {data.map((d, i) => <text key={d.key} x={x(i)} y={H - 8} textAnchor="middle" className="tick">{d.label}</text>)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cross" />}
        <path d={path('refund')} fill="none" stroke={REFUND} strokeWidth={2} strokeLinejoin="round" />
        <path d={path('income')} fill="none" stroke={REVENUE} strokeWidth={2} strokeLinejoin="round" />
        {hover !== null && <>
          <circle cx={x(hover)} cy={y(data[hover].refund)} r={4} fill={REFUND} stroke="#fff" strokeWidth={2} />
          <circle cx={x(hover)} cy={y(data[hover].income)} r={4} fill={REVENUE} stroke="#fff" strokeWidth={2} />
        </>}
        {data.map((d, i) => (
          <rect key={d.key} x={x(i) - (W - L - R) / data.length / 2} y={T} width={(W - L - R) / data.length} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${(x(hover!) / W) * 100}%` }}>
          <b>{h.key.slice(5)}/{h.key.slice(0, 4)}</b>
          <span><i style={{ background: REVENUE }} /> Doanh thu {fmtMoney(h.income)}</span>
          <span><i style={{ background: REFUND }} /> Hoàn tiền {fmtMoney(h.refund)}</span>
        </div>
      )}
    </div>
  )
}

function Donut({ parts }: { parts: { value: number; color: string }[] }) {
  const total = parts.reduce((n, p) => n + p.value, 0) || 1
  const r = 52, c = 2 * Math.PI * r
  let acc = 0
  return (
    <svg viewBox="0 0 140 140" className="donut" role="img" aria-label="Tỷ trọng doanh thu theo loại kho">
      <circle cx={70} cy={70} r={r} fill="none" stroke="var(--bg-tint)" strokeWidth={18} />
      {parts.map((p, i) => {
        const len = (p.value / total) * c
        const gap = parts.length > 1 ? Math.min(2, len) : 0
        const el = <circle key={i} cx={70} cy={70} r={r} fill="none" stroke={p.color} strokeWidth={18}
          strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />
        acc += len
        return el
      })}
      <text x={70} y={68} textAnchor="middle" className="donut-total">100%</text>
      <text x={70} y={84} textAnchor="middle" className="donut-sub">Tỷ trọng</text>
    </svg>
  )
}
