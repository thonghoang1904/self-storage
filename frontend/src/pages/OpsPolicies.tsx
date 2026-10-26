import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { checkInt, checkMoney, checkText, firstError, localToday } from '../validation'
import { api, fmtDate, fmtMoney } from '../api'
import { Badge, Empty, Icon, splitTypeName } from '../components/ui'
import { FeeMethods, type Facility, type FeeConfiguration, type Promotion, type RentalPolicy, type UnitType } from '../types'
import { CODE_FILTER } from '../validation'
import { FieldNote, useInputFilter } from '../components/form'

/**
 * #44 Operations manager, Figma "policy-fee-discount-management" (75:29417): rental policies, the fee table,
 * promotions and the monthly/daily price of each unit type (GET/POST/PUT /api/operations/rental-policies,
 * /fees, /promotions, GET /api/operations/unit-types, PUT /unit-types/{id}/pricing).
 */

type Tab = 'policies' | 'fees' | 'promotions' | 'pricing'
const TABS: { key: Tab; label: string; add?: string }[] = [
  { key: 'policies', label: 'Chính sách thuê', add: 'Thêm chính sách' },
  { key: 'fees', label: 'Bảng phí', add: 'Thêm loại phí' },
  { key: 'promotions', label: 'Khuyến mãi', add: 'Thêm khuyến mãi' },
  { key: 'pricing', label: 'Giá loại kho' },
]

const todayIso = () => localToday()
const pct = (n: number) => `${n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`
const feeAmount = (f: FeeConfiguration) => f.calculationMethod === 'Percentage' ? pct(f.defaultAmount) : `${fmtMoney(f.defaultAmount)}${f.calculationMethod === 'DailyRate' ? '/ngày' : ''}`

/** A promotion runs when it is switched on and today is inside its dates. */
function promoState(p: Promotion): { label: string; tone: 'ok' | 'warn' | 'muted' | 'info' } {
  const t = todayIso()
  if (!p.isActive) return { label: 'Tạm dừng', tone: 'muted' }
  if (t < p.startDate) return { label: 'Sắp diễn ra', tone: 'info' }
  if (t > p.endDate) return { label: 'Đã kết thúc', tone: 'muted' }
  return { label: 'Đang chạy', tone: 'ok' }
}

/** The policy in force: active, already effective, the most recent one (a facility-specific one wins for that facility). */
const currentPolicy = (ps: RentalPolicy[]) =>
  ps.filter((p) => p.isActive && p.effectiveDate <= todayIso() && p.facilityId == null).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]

export default function OpsPolicies() {
  const [tab, setTab] = useState<Tab>('policies')
  const [policies, setPolicies] = useState<RentalPolicy[]>([])
  const [fees, setFees] = useState<FeeConfiguration[]>([])
  const [promos, setPromos] = useState<Promotion[]>([])
  const [types, setTypes] = useState<UnitType[]>([])
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | 'on' | 'off'>('all')
  const [editing, setEditing] = useState<{ tab: Tab; id: number | null } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const [p, f, pr, t, fa] = await Promise.all([
        api<RentalPolicy[]>('/api/operations/rental-policies'),
        api<FeeConfiguration[]>('/api/operations/fees'),
        api<Promotion[]>('/api/operations/promotions'),
        api<UnitType[]>('/api/operations/unit-types'),
        api<Facility[]>('/api/operations/facilities'),
      ])
      setPolicies(p); setFees(f); setPromos(pr); setTypes(t); setFacilities(fa)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const saved = async (msg: string) => { setEditing(null); setError(''); setNotice(msg); await load() }
  const switchTab = (t: Tab) => { setTab(t); setEditing(null); setQ(''); setStatus('all'); setNotice('') }
  const facilityName = (id: number | null) => (id == null ? 'Toàn hệ thống' : facilities.find((f) => f.facilityId === id)?.facilityName ?? `Cơ sở #${id}`)

  const s = q.trim().toLowerCase()
  const match = (...v: (string | null | undefined)[]) => !s || v.some((x) => x?.toLowerCase().includes(s))
  const shownPolicies = useMemo(() => policies.filter((p) => match(p.policyName, facilityName(p.facilityId)) && (status === 'all' || (status === 'on') === p.isActive)), [policies, s, status, facilities]) // eslint-disable-line react-hooks/exhaustive-deps
  const shownFees = useMemo(() => fees.filter((f) => match(f.feeCode, f.feeName, f.description)), [fees, s]) // eslint-disable-line react-hooks/exhaustive-deps
  const shownPromos = useMemo(() => promos.filter((p) => match(p.promoCode, p.title) && (status === 'all' || (status === 'on') === (promoState(p).label === 'Đang chạy'))), [promos, s, status]) // eslint-disable-line react-hooks/exhaustive-deps
  const shownTypes = useMemo(() => types.filter((t) => match(t.typeName, t.description)), [types, s]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = currentPolicy(policies)
  const running = promos.filter((p) => promoState(p).label === 'Đang chạy').length
  const prices = types.map((t) => t.baseMonthlyRate)
  const tabInfo = TABS.find((t) => t.key === tab)!

  return (
    <div className="stack-xl">
      <div className="page-title-row row between wrap">
        <div>
          <h1>Chính Sách, Phí & Khuyến Mãi</h1>
          <p className="muted">Cấu hình chính sách thuê, biểu phí dịch vụ, chương trình khuyến mãi và giá thuê theo loại kho cho toàn hệ thống.</p>
        </div>
        {tabInfo.add && <button className="btn primary" onClick={() => { setNotice(''); setEditing({ tab, id: null }) }}><Icon name="plus" size={16} /> {tabInfo.add}</button>}
      </div>

      <div className="stat-grid">
        <Summary icon="clipboard" tone="info" label="Chính sách đang áp dụng" value={current ? `Cọc ${pct(current.depositPercent)}` : '—'}
          note={current ? current.policyName : 'Chưa có chính sách hiệu lực'} />
        <Summary icon="wallet" tone="warn" label="Biểu phí dịch vụ" value={`${fees.length} loại phí`} note={`${fees.filter((f) => f.calculationMethod !== 'Fixed').length} loại tính theo ngày/%`} />
        <Summary icon="card" tone="ok" label="Khuyến mãi đang chạy" value={String(running)} note={`${promos.length} chương trình đã tạo`} />
        <Summary icon="package" tone="info" label="Giá thuê theo tháng" value={prices.length ? `${fmtShort(Math.min(...prices))} – ${fmtShort(Math.max(...prices))}` : '—'} note={`${types.length} loại kho`} />
      </div>

      <div className="panel filter-bar">
        <div className="segmented policy-tabs">
          {TABS.map((t) => <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => switchTab(t.key)}>{t.label}</button>)}
        </div>
        <div className="filter-controls">
          <span className="input-wrap grow-2">
            <Icon name="search" size={16} className="input-lead" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'fees' ? 'Tìm mã hoặc tên phí…' : tab === 'promotions' ? 'Tìm mã khuyến mãi…' : tab === 'pricing' ? 'Tìm loại kho…' : 'Tìm chính sách…'} />
          </span>
          {(tab === 'policies' || tab === 'promotions') && (
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Trạng thái">
              <option value="all">Trạng thái: Tất cả</option>
              <option value="on">{tab === 'promotions' ? 'Trạng thái: Đang chạy' : 'Trạng thái: Đang bật'}</option>
              <option value="off">{tab === 'promotions' ? 'Trạng thái: Không chạy' : 'Trạng thái: Đã tắt'}</option>
            </select>
          )}
        </div>
      </div>

      {notice && <p className="alert ok"><Icon name="check" size={16} />{notice}</p>}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}

      <div className="policy-workspace">
        <section className="panel stack">
          <div>
            <h3 className="panel-title">{tab === 'policies' ? 'Chính sách thuê' : tab === 'fees' ? 'Bảng phí dịch vụ' : tab === 'promotions' ? 'Chương trình khuyến mãi' : 'Giá thuê theo loại kho'}</h3>
            <p className="muted">{tab === 'policies' ? 'Tỷ lệ cọc, thời gian hủy miễn phí, hạn gia hạn và khóa kho khi quá hạn.'
              : tab === 'fees' ? 'Các khoản phí phát sinh nhân viên cơ sở có thể áp vào hợp đồng.'
              : tab === 'promotions' ? 'Mã giảm giá khách nhập khi đặt kho, áp một lần trên hóa đơn thuê đầu tiên.'
              : 'Đổi giá tháng sẽ cập nhật giá của mọi kho thuộc loại đó.'}</p>
          </div>

          {editing?.tab === 'policies' && <PolicyForm policy={policies.find((p) => p.policyId === editing.id)} facilities={facilities} onCancel={() => setEditing(null)} onSaved={saved} />}
          {editing?.tab === 'fees' && <FeeForm fee={fees.find((f) => f.feeTypeId === editing.id)} onCancel={() => setEditing(null)} onSaved={saved} />}
          {editing?.tab === 'promotions' && <PromotionForm promo={promos.find((p) => p.promotionId === editing.id)} onCancel={() => setEditing(null)} onSaved={saved} />}

          <div className="policy-list">
            {tab === 'policies' && shownPolicies.map((p) => (
              <PolicyItem key={p.policyId} code={`CS-${String(p.policyId).padStart(3, '0')}`} badge={p.isActive ? (p.effectiveDate > todayIso() ? { label: 'Chờ hiệu lực', tone: 'info' } : { label: 'Đang bật', tone: 'ok' }) : { label: 'Đã tắt', tone: 'muted' }}
                title={p.policyName} meta={`${facilityName(p.facilityId)} · hiệu lực từ ${fmtDate(p.effectiveDate)}`} onEdit={() => setEditing({ tab: 'policies', id: p.policyId })}>
                <span>Cọc <b>{pct(p.depositPercent)}</b></span>
                <span>Hủy miễn phí <b>{p.cancellationGraceHours} giờ</b>, sau đó phí <b>{pct(p.cancellationFeePercent)}</b></span>
                <span>Nhắc gia hạn trước <b>{p.renewalNoticeDays} ngày</b></span>
                <span>Khóa kho sau <b>{p.maxOverdueDaysBeforeLock} ngày</b> quá hạn</span>
              </PolicyItem>
            ))}
            {tab === 'fees' && shownFees.map((f) => (
              <PolicyItem key={f.feeTypeId} code={f.feeCode} badge={{ label: FeeMethods[f.calculationMethod] ?? f.calculationMethod, tone: f.calculationMethod === 'Fixed' ? 'info' : 'warn' }}
                title={f.feeName} meta={f.description ?? ''} amount={feeAmount(f)} onEdit={() => setEditing({ tab: 'fees', id: f.feeTypeId })} />
            ))}
            {tab === 'promotions' && shownPromos.map((p) => {
              const st = promoState(p)
              return (
                <PolicyItem key={p.promotionId} code={p.promoCode} badge={st} title={p.title}
                  meta={`${fmtDate(p.startDate)} – ${fmtDate(p.endDate)}`} amount={`-${pct(p.discountPercent)}`} onEdit={() => setEditing({ tab: 'promotions', id: p.promotionId })}>
                  <span>Thuê tối thiểu <b>{p.minRentalMonths} tháng</b></span>
                  <span>Giảm tối đa <b>{p.maxDiscountAmount != null ? fmtMoney(p.maxDiscountAmount) : 'không giới hạn'}</b></span>
                </PolicyItem>
              )
            })}
            {tab === 'pricing' && shownTypes.map((t) => <PriceRow key={t.unitTypeId} type={t} onSaved={saved} />)}

            {((tab === 'policies' && !shownPolicies.length) || (tab === 'fees' && !shownFees.length) || (tab === 'promotions' && !shownPromos.length) || (tab === 'pricing' && !shownTypes.length)) &&
              <Empty icon="clipboard">Không có mục nào khớp bộ lọc.</Empty>}
          </div>
        </section>

        <aside className="stack-lg">
          <section className="panel">
            <h3 className="panel-title">Chính sách đang áp dụng</h3>
            {current ? (
              <>
                <p className="muted">{current.policyName} · từ {fmtDate(current.effectiveDate)}</p>
                <div className="info-row"><span className="muted">Tiền cọc</span><b>{pct(current.depositPercent)} giá tháng</b></div>
                <div className="info-row"><span className="muted">Hủy miễn phí trong</span><b>{current.cancellationGraceHours} giờ</b></div>
                <div className="info-row"><span className="muted">Phí hủy sau đó</span><b>{pct(current.cancellationFeePercent)}</b></div>
                <div className="info-row"><span className="muted">Nhắc gia hạn trước</span><b>{current.renewalNoticeDays} ngày</b></div>
                <div className="info-row"><span className="muted">Khóa kho khi quá hạn</span><b>{current.maxOverdueDaysBeforeLock} ngày</b></div>
                <div className="chip-row">
                  <Badge tone="ok">Áp dụng toàn hệ thống</Badge>
                  {policies.some((p) => p.facilityId != null && p.isActive) && <Badge tone="info">Có chính sách riêng theo cơ sở</Badge>}
                </div>
              </>
            ) : <Empty icon="clipboard">Chưa có chính sách đang hiệu lực.</Empty>}
          </section>

          <section className="panel">
            <h3 className="panel-title">Biểu phí hiện hành</h3>
            <div className="fee-table">
              {fees.slice(0, 6).map((f) => (
                <div key={f.feeTypeId} className="info-row"><span className="muted">{f.feeName}</span><b>{feeAmount(f)}</b></div>
              ))}
            </div>
            {fees.length > 6 && <button className="link-btn" onClick={() => switchTab('fees')}>Xem tất cả {fees.length} loại phí</button>}
          </section>

          <section className="panel">
            <h3 className="panel-title">Khuyến mãi đang chạy</h3>
            {promos.filter((p) => promoState(p).label === 'Đang chạy').map((p) => (
              <div key={p.promotionId} className="info-row"><span><span className="code">{p.promoCode}</span> <small className="muted">đến {fmtDate(p.endDate)}</small></span><b className="cyan">-{pct(p.discountPercent)}</b></div>
            ))}
            {running === 0 && <p className="muted">Không có chương trình nào đang chạy.</p>}
          </section>
        </aside>
      </div>
    </div>
  )
}

const fmtShort = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}tr` : `${Math.round(n / 1000)}k`)

function Summary({ icon, tone, label, value, note }: { icon: string; tone: string; label: string; value: string; note: string }) {
  return (
    <div className="stat-card">
      <div className="row between"><span className="muted">{label}</span><span className={`stat-icon ${tone}`}><Icon name={icon} size={17} /></span></div>
      <b className="stat-value">{value}</b>
      <small className={`stat-note ${tone}`}>{note}</small>
    </div>
  )
}

function PolicyItem({ code, badge, title, meta, amount, onEdit, children }: {
  code: string; badge: { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted' }; title: string; meta: string; amount?: string; onEdit: () => void; children?: ReactNode
}) {
  return (
    <article className="policy-item">
      <div className="row between wrap">
        <span className="row"><span className="code-chip">{code}</span><Badge tone={badge.tone}>{badge.label}</Badge></span>
        {amount && <b className="policy-amount">{amount}</b>}
      </div>
      <b className="policy-title">{title}</b>
      {children && <div className="policy-facts">{children}</div>}
      <div className="row between wrap">
        <small className="muted">{meta}</small>
        <button className="link-btn" onClick={onEdit}><Icon name="settings" size={14} /> Chỉnh sửa</button>
      </div>
    </article>
  )
}

/** Shared save handler for the three editors. */
function useSave(onSaved: (msg: string) => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (path: string, method: 'POST' | 'PUT', body: unknown, msg: string, problem = '') => {
    if (problem) { setError(problem); return }
    setBusy(true)
    setError('')
    try {
      await api(path, { method, body })
      onSaved(msg)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, save }
}

function FormShell({ title, busy, error, onCancel, onSubmit, children }: { title: string; busy: boolean; error: string; onCancel: () => void; onSubmit: (e: FormEvent) => void; children: ReactNode }) {
  return (
    <form className="policy-form" onSubmit={onSubmit}>
      <h4>{title}</h4>
      {children}
      {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
      <div className="row">
        <button className="btn primary sm" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
        <button className="btn ghost sm" type="button" onClick={onCancel}>Hủy</button>
      </div>
    </form>
  )
}

function PolicyForm({ policy, facilities, onCancel, onSaved }: { policy?: RentalPolicy; facilities: Facility[]; onCancel: () => void; onSaved: (m: string) => void }) {
  const [f, setF] = useState(() => policy ?? { policyName: '', facilityId: null, depositPercent: 100, cancellationGraceHours: 24, cancellationFeePercent: 10, renewalNoticeDays: 7, maxOverdueDaysBeforeLock: 1, isActive: true, effectiveDate: todayIso() })
  const { busy, error, save } = useSave(onSaved)
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const body = { policyName: f.policyName.trim(), facilityId: f.facilityId, depositPercent: Number(f.depositPercent), cancellationGraceHours: Number(f.cancellationGraceHours), cancellationFeePercent: Number(f.cancellationFeePercent), renewalNoticeDays: Number(f.renewalNoticeDays), maxOverdueDaysBeforeLock: Number(f.maxOverdueDaysBeforeLock), isActive: f.isActive, effectiveDate: f.effectiveDate }
    void save(policy ? `/api/operations/rental-policies/${policy.policyId}` : '/api/operations/rental-policies', policy ? 'PUT' : 'POST', body, `Đã lưu chính sách "${body.policyName}".`, firstError(
      checkText(f.policyName, 'Tên chính sách', 100, false, 3),
      Number(f.depositPercent) > 0 && Number(f.depositPercent) <= 100 ? '' : 'Tiền cọc từ 0,01% đến 100% giá tháng',
      checkInt(f.cancellationGraceHours, 'Thời gian hủy miễn phí (giờ)', 0, 8760),
      Number(f.cancellationFeePercent) >= 0 && Number(f.cancellationFeePercent) <= 100 ? '' : 'Phí hủy từ 0% đến 100%',
      checkInt(f.renewalNoticeDays, 'Số ngày nhắc gia hạn', 0, 365),
      checkInt(f.maxOverdueDaysBeforeLock, 'Số ngày quá hạn trước khi khóa', 0, 365),
      /^\d{4}-\d{2}-\d{2}$/.test(f.effectiveDate) ? '' : 'Vui lòng chọn ngày hiệu lực',
    ))
  }
  return (
    <FormShell title={policy ? 'Sửa chính sách thuê' : 'Thêm chính sách thuê'} busy={busy} error={error} onCancel={onCancel} onSubmit={submit}>
      <div className="form-grid">
        <label className="field"><span>Tên chính sách *</span><input value={f.policyName} maxLength={100} onChange={(e) => set('policyName', e.target.value)} required /></label>
        <label className="field"><span>Áp dụng cho</span>
          <select value={f.facilityId ?? ''} onChange={(e) => set('facilityId', e.target.value ? Number(e.target.value) : null)}>
            <option value="">Toàn hệ thống</option>
            {facilities.map((x) => <option key={x.facilityId} value={x.facilityId}>{x.facilityName}</option>)}
          </select>
        </label>
        <label className="field"><span>Tiền cọc (% giá tháng) *</span><input type="number" min={0.01} max={100} step="0.01" value={f.depositPercent} onChange={(e) => set('depositPercent', e.target.value)} required /></label>
        <label className="field"><span>Hủy miễn phí trong (giờ)</span><input type="number" min={0} max={8760} value={f.cancellationGraceHours} onChange={(e) => set('cancellationGraceHours', e.target.value)} /></label>
        <label className="field"><span>Phí hủy sau thời gian đó (%)</span><input type="number" min={0} max={100} step="0.01" value={f.cancellationFeePercent} onChange={(e) => set('cancellationFeePercent', e.target.value)} /></label>
        <label className="field"><span>Nhắc gia hạn trước (ngày)</span><input type="number" min={0} max={365} value={f.renewalNoticeDays} onChange={(e) => set('renewalNoticeDays', e.target.value)} /></label>
        <label className="field"><span>Khóa kho sau khi quá hạn (ngày)</span><input type="number" min={0} max={365} value={f.maxOverdueDaysBeforeLock} onChange={(e) => set('maxOverdueDaysBeforeLock', e.target.value)} /></label>
        <label className="field"><span>Ngày hiệu lực *</span><input type="date" value={f.effectiveDate} onChange={(e) => set('effectiveDate', e.target.value)} required /></label>
      </div>
      <label className="check-line"><input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} /><span>Bật chính sách này</span></label>
    </FormShell>
  )
}

function FeeForm({ fee, onCancel, onSaved }: { fee?: FeeConfiguration; onCancel: () => void; onSaved: (m: string) => void }) {
  const [f, setF] = useState(() => fee ?? { feeCode: '', feeName: '', defaultAmount: 0, calculationMethod: 'Fixed', description: '' })
  const { busy, error, save } = useSave(onSaved)
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const body = { feeCode: f.feeCode.trim().toUpperCase(), feeName: f.feeName.trim(), defaultAmount: Number(f.defaultAmount), calculationMethod: f.calculationMethod, description: f.description || null }
    void save(fee ? `/api/operations/fees/${fee.feeTypeId}` : '/api/operations/fees', fee ? 'PUT' : 'POST', body, `Đã lưu loại phí ${body.feeCode}.`, firstError(
      /^[A-Z][A-Z0-9_]{1,49}$/.test(body.feeCode) ? '' : 'Mã phí chỉ gồm chữ in hoa không dấu, số và _ (vd: CLEANING_FEE)',
      checkText(f.feeName, 'Tên phí', 100, false, 3),
      f.calculationMethod === 'Percentage'
        ? (body.defaultAmount > 0 && body.defaultAmount <= 100 ? '' : 'Tỷ lệ phí từ trên 0% đến 100%')
        : checkMoney(body.defaultAmount, 'Số tiền phí', 0),
      checkText(f.description ?? '', 'Mô tả', 255, true),
    ))
  }
  return (
    <FormShell title={fee ? 'Sửa loại phí' : 'Thêm loại phí'} busy={busy} error={error} onCancel={onCancel} onSubmit={submit}>
      <div className="form-grid">
        <label className="field"><span>Mã phí *</span><input value={f.feeCode} maxLength={50} placeholder="VD: CLEANING_FEE" onChange={(e) => set('feeCode', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} required /></label>
        <label className="field"><span>Tên phí *</span><input value={f.feeName} maxLength={100} onChange={(e) => set('feeName', e.target.value)} required /></label>
        <label className="field"><span>Cách tính *</span>
          <select value={f.calculationMethod} onChange={(e) => set('calculationMethod', e.target.value)}>
            {Object.entries(FeeMethods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field"><span>{f.calculationMethod === 'Percentage' ? 'Tỷ lệ (%)' : 'Số tiền (đ)'} *</span><input type="number" min={0} step="any" value={f.defaultAmount} onChange={(e) => set('defaultAmount', e.target.value)} required /></label>
      </div>
      <label className="field"><span>Mô tả</span><input value={f.description ?? ''} maxLength={255} onChange={(e) => set('description', e.target.value)} /></label>
    </FormShell>
  )
}

function PromotionForm({ promo, onCancel, onSaved }: { promo?: Promotion; onCancel: () => void; onSaved: (m: string) => void }) {
  const [f, setF] = useState(() => promo ?? { promoCode: '', title: '', discountPercent: 10, maxDiscountAmount: null as number | null, minRentalMonths: 1, startDate: todayIso(), endDate: todayIso(), isActive: true })
  const code = useInputFilter(CODE_FILTER)
  const { busy, error, save } = useSave(onSaved)
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const max = f.maxDiscountAmount as unknown
    const body = { promoCode: f.promoCode.trim().toUpperCase(), title: f.title.trim(), discountPercent: Number(f.discountPercent), maxDiscountAmount: max === null || max === '' ? null : Number(max), minRentalMonths: Number(f.minRentalMonths), startDate: f.startDate, endDate: f.endDate, isActive: f.isActive }
    void save(promo ? `/api/operations/promotions/${promo.promotionId}` : '/api/operations/promotions', promo ? 'PUT' : 'POST', body, `Đã lưu khuyến mãi ${body.promoCode}.`, firstError(
      /^[A-Z0-9_-]{3,30}$/.test(body.promoCode) ? '' : 'Mã khuyến mãi 3–30 ký tự, chỉ gồm chữ in hoa không dấu, số, - và _',
      checkText(f.title, 'Tên chương trình', 150, false, 3),
      body.discountPercent > 0 && body.discountPercent <= 100 ? '' : 'Mức giảm từ trên 0% đến 100%',
      body.maxDiscountAmount == null ? '' : checkMoney(body.maxDiscountAmount, 'Giảm tối đa', 1000),
      checkInt(body.minRentalMonths, 'Thuê tối thiểu (tháng)', 1, 60),
      f.startDate && f.endDate ? '' : 'Vui lòng chọn thời gian áp dụng',
      f.endDate >= f.startDate ? '' : 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu',
      !promo && f.endDate < todayIso() ? 'Khuyến mãi mới không được kết thúc trong quá khứ' : '',
    ))
  }
  return (
    <FormShell title={promo ? 'Sửa khuyến mãi' : 'Thêm khuyến mãi'} busy={busy} error={error} onCancel={onCancel} onSubmit={submit}>
      <div className="form-grid">
        <label className="field"><span>Mã khuyến mãi *</span><input value={f.promoCode} maxLength={30} placeholder="VD: WELCOME10" onChange={(e) => set('promoCode', code.keep(e.target.value))} required /><FieldNote text={code.hint} /></label>
        <label className="field"><span>Tên chương trình *</span><input value={f.title} maxLength={150} onChange={(e) => set('title', e.target.value)} required /></label>
        <label className="field"><span>Mức giảm (%) *</span><input type="number" min={0} max={100} step="0.01" value={f.discountPercent} onChange={(e) => set('discountPercent', e.target.value)} required /></label>
        <label className="field"><span>Giảm tối đa (đ, để trống = không giới hạn)</span><input type="number" min={0} value={f.maxDiscountAmount ?? ''} onChange={(e) => set('maxDiscountAmount', e.target.value === '' ? null : e.target.value)} /></label>
        <label className="field"><span>Thuê tối thiểu (tháng) *</span><input type="number" min={1} max={60} value={f.minRentalMonths} onChange={(e) => set('minRentalMonths', e.target.value)} required /></label>
        <span />
        <label className="field"><span>Từ ngày *</span><input type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} required /></label>
        <label className="field"><span>Đến ngày *</span><input type="date" value={f.endDate} min={f.startDate} onChange={(e) => set('endDate', e.target.value)} required /></label>
      </div>
      <label className="check-line"><input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} /><span>Bật chương trình</span></label>
    </FormShell>
  )
}

/** One unit type with its prices, edited in place. */
function PriceRow({ type: t, onSaved }: { type: UnitType; onSaved: (m: string) => void }) {
  const [edit, setEdit] = useState(false)
  const [daily, setDaily] = useState(String(t.baseDailyRate))
  const [monthly, setMonthly] = useState(String(t.baseMonthlyRate))
  const { busy, error, save } = useSave((m) => { setEdit(false); onSaved(m) })
  const { name, size } = splitTypeName(t.typeName)
  return (
    <article className="policy-item">
      <div className="row between wrap">
        <span className="row"><span className="code-chip">LK-{String(t.unitTypeId).padStart(2, '0')}</span>{t.hasClimateControl && <Badge tone="info">Điều hòa</Badge>}</span>
        {!edit && <b className="policy-amount">{fmtMoney(t.baseMonthlyRate)}<small>/tháng</small></b>}
      </div>
      <b className="policy-title">{name} <small className="muted">{size}</small></b>
      {edit ? (
        <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); void save(`/api/operations/unit-types/${t.unitTypeId}/pricing`, 'PUT', { baseDailyRate: Number(daily), baseMonthlyRate: Number(monthly) }, `Đã cập nhật giá ${name}.`, firstError(
              checkMoney(monthly, 'Giá theo tháng', 1000),
              checkMoney(daily, 'Giá theo ngày', 0),
              Number(daily) > Number(monthly) ? 'Giá theo ngày không được lớn hơn giá theo tháng' : '',
            )) }}>
          <div className="form-grid">
            <label className="field"><span>Giá theo ngày (đ)</span><input type="number" min={0} value={daily} onChange={(e) => setDaily(e.target.value)} /></label>
            <label className="field"><span>Giá theo tháng (đ) *</span><input type="number" min={1} value={monthly} onChange={(e) => setMonthly(e.target.value)} required /></label>
          </div>
          {error && <p className="alert bad"><Icon name="alert" size={16} />{error}</p>}
          <div className="row">
            <button className="btn primary sm" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu giá'}</button>
            <button className="btn ghost sm" type="button" onClick={() => setEdit(false)}>Hủy</button>
          </div>
        </form>
      ) : (
        <div className="row between wrap">
          <small className="muted">Giá ngày {fmtMoney(t.baseDailyRate)} · {t.description ?? ''}</small>
          <button className="link-btn" onClick={() => setEdit(true)}><Icon name="settings" size={14} /> Đổi giá</button>
        </div>
      )}
    </article>
  )
}
