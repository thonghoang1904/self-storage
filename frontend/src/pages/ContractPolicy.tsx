import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { api, fmtDate, fmtMoney, fmtTime } from '../api'
import { Empty, Icon, splitTypeName, StatusBadge } from '../components/ui'
import { ContractUnitArt } from '../components/unitPhoto'
import { ExtraChargeFees, type ContractDetail, type Facility, type Renewal, type StorageUnit } from '../types'
import { TERMS_VERSION, termsHref } from './Terms'

/**
 * Figma "Xem trước policy của hợp đồng" (96:11044): the customer reads the policy that applies to their contract
 * (rules the backend enforces, the fee table and the contract's own amounts) and any pending appendix (a renewal not
 * yet paid) as "not in force yet". Nothing to confirm: it is opened from a step (?from=renew|suspend|early-return)
 * and a button takes the customer straight back to that step.
 */

type Section = { id: string; code: string; title: string; body: string[] }

function sections(c: ContractDetail, hours?: string): Section[] {
  return [
    {
      id: 'pay', code: 'CS-TT-01', title: 'Thanh toán & tiền cọc',
      body: [
        `Tiền thuê ${fmtMoney(c.monthlyRentFee)}/tháng, hóa đơn phát hành theo từng kỳ một tháng kể từ ngày bắt đầu ${fmtDate(c.startDate)}; thanh toán online qua VNPay hoặc tại quầy.`,
        `Tiền cọc ${fmtMoney(c.depositPaid)} được giữ suốt thời hạn hợp đồng và hoàn lại khi trả kho, sau khi đối soát phí phát sinh.`,
      ],
    },
    {
      id: 'renew', code: 'CS-GH-01', title: 'Gia hạn hợp đồng',
      body: [
        `Có thể gia hạn sớm bất cứ lúc nào khi hợp đồng còn hiệu lực, chậm nhất 20:00 ngày ${fmtDate(c.endDate)}.`,
        'Thời hạn mới cộng tiếp từ ngày hết hạn hiện tại và có hiệu lực sau khi thanh toán phí gia hạn (số tháng × tiền thuê tháng).',
      ],
    },
    {
      id: 'return', code: 'CS-TK-01', title: 'Trả kho, quá hạn & hoàn cọc',
      body: [
        `Trả kho trước 20:00 ngày ${fmtDate(c.endDate)}. Nhân viên kiểm tra kho cùng khách, đối soát phí và hoàn phần cọc còn lại.`,
        `Quá 24 giờ kể từ 20:00 ngày hết hạn, kho bị khóa và tính phí mỗi ngày bằng tiền thuê tháng / 30 (${fmtMoney(Math.round(c.monthlyRentFee / 30))}/ngày), cấn trừ vào tiền cọc; phần vượt cọc lập thành hóa đơn.`,
      ],
    },
    {
      id: 'fees', code: 'BP-2026', title: 'Bảng phí phát sinh hiện hành', body: [],
    },
    {
      id: 'access', code: 'CS-RV-01', title: 'Truy cập, bảo mật & trách nhiệm',
      body: [
        `Chỉ chủ hợp đồng hoặc người được ủy quyền (bất kỳ ai, dùng CCCD của chính họ) được vào kho, trong giờ ${hours ?? 'hoạt động của cơ sở'}. Mỗi lượt vào cần lịch đã được duyệt; không dùng mã PIN.`,
        'Không gửi chất cháy nổ, hóa chất, thực phẩm tươi sống, động vật, hàng cấm. Khách chịu trách nhiệm về nguồn gốc đồ gửi; SafeKeep chịu trách nhiệm theo điều khoản hợp đồng.',
      ],
    },
  ]
}

export function useContract(id: number) {
  const [c, setC] = useState<ContractDetail | null>(null)
  const [renewals, setRenewals] = useState<Renewal[]>([])
  const [facility, setFacility] = useState<Facility | null>(null)
  const [unitType, setUnitType] = useState('')
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    try {
      const d = await api<ContractDetail>(`/api/contracts/${id}`)
      setC(d)
      api<Facility[]>('/api/facilities').then((fs) => setFacility(fs.find((f) => f.facilityId === d.facilityId) ?? null)).catch(() => {})
      api<StorageUnit[]>(`/api/facilities/${d.facilityId}/units`).then((us) => setUnitType(us.find((u) => u.unitId === d.unitId)?.unitTypeName ?? '')).catch(() => {})
    } catch (e) {
      setError((e as Error).message)
    }
    await api<Renewal[]>(`/api/contracts/${id}/renewals`).then(setRenewals).catch(() => {})
  }, [id])
  useEffect(() => { void reload() }, [reload])
  return { c, renewals, facility, unitType, error, reload }
}

export function Hero({ c, title, subtitle, crumb }: { c: ContractDetail; title: string; subtitle: string; crumb: string }) {
  const active = c.status === 'Active' || c.status === 'Renewed'
  return (
    <section className="page-hero detail-hero">
      <div className="container">
        <div className="grow">
          <nav className="crumbs"><Link to="/my-units">Kho Của Tôi</Link><span>/</span><Link to={`/my-units/${c.contractId}`}>{c.unitCode}</Link><span>/</span><b>{crumb}</b></nav>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="hero-side">
          <span className={`badge ${active ? 'ok' : 'muted'}`}>{active ? 'Hợp đồng đang hiệu lực' : 'Hợp đồng đã kết thúc'}</span>
          <small>Hợp đồng {c.contractNumber}</small>
        </div>
      </div>
    </section>
  )
}

export function Loading({ error }: { error: string }) {
  return (
    <div className="container page-body">
      {error ? <p className="alert bad"><Icon name="alert" size={16} />{error}</p> : <p className="muted">Đang tải hợp đồng…</p>}
      <Link to="/my-units" className="link">← Về Kho Của Tôi</Link>
    </div>
  )
}

/** Figma "Active contract" strip: unit, current term, rent, deposit. */
export function ContractStrip({ c, unitType }: { c: ContractDetail; unitType: string }) {
  const type = unitType ? splitTypeName(unitType) : null
  return (
    <section className="panel contract-strip">
      <div className="unit-photo xs"><ContractUnitArt facilityId={c.facilityId} unitId={c.unitId} /></div>
      <div className="strip-identity">
        <b>{type ? `${type.name} ${type.size}` : `Kho ${c.unitCode}`} · {c.unitCode}</b>
        <small className="muted">{c.facilityName}</small>
        <StatusBadge status={c.status} />
      </div>
      <div><small className="muted">Thời hạn hiện tại</small><b>{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</b></div>
      <div><small className="muted">Tiền thuê</small><b>{fmtMoney(c.monthlyRentFee)} / tháng</b></div>
      <div><small className="muted">Tiền cọc</small><b>{fmtMoney(c.depositPaid)}</b></div>
    </section>
  )
}

const BACK: Record<string, { label: string; hint: string; path: (id: number) => string }> = {
  renew: { label: 'Quay lại gia hạn', hint: 'Quay lại trang gia hạn để tiếp tục chọn thời gian và gửi yêu cầu.', path: (id) => `/my-units/${id}/renew` },
  suspend: { label: 'Quay lại tạm ngưng', hint: 'Quay lại trang tạm ngưng hợp đồng để tiếp tục.', path: (id) => `/my-units/${id}/suspend` },
  'early-return': { label: 'Quay lại trả kho sớm', hint: 'Quay lại yêu cầu trả kho sớm của bạn.', path: (id) => `/my-units/${id}/early-return` },
  contract: { label: 'Quay lại hợp đồng', hint: 'Quay lại trang chi tiết kho & hợp đồng.', path: (id) => `/my-units/${id}` },
}

export default function ContractPolicy() {
  const id = Number(useParams().id)
  const from = new URLSearchParams(useLocation().search).get('from') ?? ''
  const { c, renewals, facility, unitType, error } = useContract(id)
  if (!c) return <Loading error={error} />

  // Opened from another step (renewal, suspension, early return): after reading, go straight back to it.
  const back = BACK[from] ?? BACK.contract
  const backTo = back.path(c.contractId)
  const list = sections(c, facility?.operatingHours)
  const pending = renewals.find((r) => r.status === 'Pending')
  const go = (sid: string) => document.getElementById(`policy-${sid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <>
      <Hero c={c} crumb="Policy hợp đồng" title="Xem trước policy của hợp đồng" subtitle={`Xem lại điều khoản đang áp dụng cho hợp đồng ${c.contractNumber}.`} />
      <div className="container page-body">
        <ContractStrip c={c} unitType={unitType} />

        <div className="notice info-notice">
          <span className="notice-icon info"><Icon name="clipboard" size={16} /></span>
          <div>
            <b>Policy đang áp dụng cho hợp đồng {c.contractNumber}</b>
            <p>Đây là các điều khoản có hiệu lực theo hợp đồng của bạn. Nội dung đề xuất (nếu có) chỉ có hiệu lực sau khi hoàn tất thủ tục.</p>
          </div>
        </div>

        <div className="policy-layout">
          <div className="stack-lg">
            <section className="panel stack">
              <div><h2 className="panel-title">Điều khoản hiện có để đối chiếu</h2><p className="muted">Đang áp dụng · phiên bản {TERMS_VERSION}</p></div>
              {list.map((s) => s.id === 'fees' ? (
                <div key={s.id} id={`policy-${s.id}`} className="policy-fees">
                  <b>{s.title}</b>
                  {ExtraChargeFees.filter((f) => !f.perDay).map((f) => (
                    <div key={f.feeTypeId} className="info-row"><span className="muted">{f.feeName}</span><b>{fmtMoney(f.defaultAmount)}</b></div>
                  ))}
                  <div className="info-row"><span className="muted">Phí lưu kho quá hạn (tiền thuê / 30)</span><b>{fmtMoney(Math.round(c.monthlyRentFee / 30))} / ngày</b></div>
                  <small className="muted">Phí phát sinh chỉ thu khi có sự việc thực tế và được nhân viên lập hóa đơn.</small>
                </div>
              ) : (
                <article key={s.id} id={`policy-${s.id}`} className="policy-card">
                  <div className="row between"><small className="code muted">{s.code} · Hiện hành</small><span className="badge ok">Đang áp dụng</span></div>
                  <h3>{s.title}</h3>
                  {s.body.map((t) => <p key={t}>{t}</p>)}
                </article>
              ))}
            </section>

            <section id="policy-draft" className="panel stack">
              <div><h2 className="panel-title">Nội dung đề xuất — chưa có hiệu lực</h2><p className="muted">Các thay đổi đang chờ hoàn tất, chưa áp dụng cho hợp đồng.</p></div>
              {pending ? (
                <>
                  <span className="badge warn self-start">Chờ thanh toán</span>
                  <article className="policy-card draft">
                    <h3>Phụ lục gia hạn {pending.extensionMonths} tháng</h3>
                    <p>Ngày hết hạn đổi từ <b>{fmtDate(pending.oldEndDate)}</b> sang <b>{fmtDate(pending.newEndDate)}</b>; phí gia hạn {fmtMoney(pending.renewalFee)}.</p>
                    <p>Gửi yêu cầu lúc {fmtTime(pending.requestedAt)}. Phụ lục có hiệu lực ngay khi hóa đơn gia hạn được thanh toán.</p>
                  </article>
                  <div className="notice warn-notice">
                    <span className="notice-icon warn"><Icon name="alert" size={16} /></span>
                    <div><p>Chưa thanh toán trước 20:00 ngày {fmtDate(pending.oldEndDate)} thì phụ lục tự hết hiệu lực và hợp đồng giữ ngày hết hạn cũ.</p></div>
                  </div>
                  <Link to="/invoices" className="link with-icon"><Icon name="wallet" size={14} /> Thanh toán phí gia hạn</Link>
                </>
              ) : <Empty icon="clipboard">Không có nội dung đề xuất nào đang chờ.</Empty>}
            </section>
          </div>

          <aside className="stack-lg policy-aside">
            <section className="panel stack-sm">
              <h3 className="panel-title">Phiên bản của bản xem trước</h3>
              <div className="info-row"><span className="muted">Mã hợp đồng</span><b>{c.contractNumber}</b></div>
              <div className="info-row"><span className="muted">Phiên bản điều khoản</span><b>{TERMS_VERSION}</b></div>
              <div className="info-row"><span className="muted">Hiệu lực từ</span><b>{fmtDate(c.startDate)}</b></div>
              <hr />
              <small className="muted">Bản xem trước tóm tắt các điều khoản chính. Toàn văn áp dụng chung cho mọi hợp đồng ở trang Điều khoản.</small>
              <Link to={termsHref({ back: `/my-units/${c.contractId}/policy${from ? `?from=${from}` : ''}`, label: 'Quay lại policy hợp đồng', ...(from && BACK[from] ? { next: backTo, nextLabel: back.label.replace('Quay lại', 'Tiếp tục') } : {}) })} className="btn outline block"><Icon name="file" size={15} /> Xem toàn văn điều khoản</Link>
              <Link to={backTo} className="btn primary block"><Icon name="arrowRight" size={15} className="flip" /> {back.label}</Link>
            </section>
            <section className="panel stack-sm">
              <h3 className="panel-title">Nội dung cần xem</h3>
              <ol className="policy-toc">
                {[...list, { id: 'draft', title: 'Nội dung đề xuất', code: '', body: [] }].map((s, i) => (
                  <li key={s.id}><button type="button" onClick={() => go(s.id)}><span>{String(i + 1).padStart(2, '0')}</span>{s.title}</button></li>
                ))}
              </ol>
            </section>
            <div className="notice warn-notice">
              <span className="notice-icon warn"><Icon name="alert" size={16} /></span>
              <div><b>Có thắc mắc về điều khoản?</b><p>Liên hệ cơ sở {c.facilityName}{facility?.hotline && ` (${facility.hotline})`} hoặc gửi yêu cầu hỗ trợ.</p></div>
            </div>
          </aside>
        </div>

        <section className="panel policy-done-bar">
          <div className="grow"><b>Đã đọc xong policy?</b><p className="muted">{back.hint}</p></div>
          <Link to={backTo} className="btn primary"><Icon name="arrowRight" size={16} className="flip" /> {back.label}</Link>
        </section>
      </div>
    </>
  )
}
