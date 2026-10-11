import { useEffect, useState } from 'react'
import { kioskApi } from '../api'
import type { KioskStatus } from '../types'

const PIN_LENGTH = 6
const RESET_AFTER_MS = 8000

/**
 * Full-screen gate kiosk. The visitor types the unit code and PIN; after a correct PIN the
 * screen waits until the staff on duty checks their ID card and grants or denies entry.
 */
export default function Kiosk() {
  const [unitCode, setUnitCode] = useState('')
  const [pin, setPin] = useState('')
  const [step, setStep] = useState<'unit' | 'pin'>('unit')
  const [status, setStatus] = useState<KioskStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setUnitCode('')
    setPin('')
    setStep('unit')
    setStatus(null)
    setError('')
  }

  // While pending, poll until staff decides.
  useEffect(() => {
    if (status?.status !== 'Pending') return
    const id = setInterval(async () => {
      try {
        setStatus(await kioskApi<KioskStatus>(`/api/kiosk/requests/${status.requestId}`))
      } catch {
        /* keep polling */
      }
    }, 2000)
    return () => clearInterval(id)
  }, [status])

  // After a final answer, go back to the start screen.
  useEffect(() => {
    if (!status || status.status === 'Pending') return
    const id = setTimeout(reset, RESET_AFTER_MS)
    return () => clearTimeout(id)
  }, [status])

  const submit = async (fullPin: string) => {
    setBusy(true)
    setError('')
    try {
      setStatus(await kioskApi<KioskStatus>('/api/kiosk/pin', { unitCode: unitCode.trim().toUpperCase(), pin: fullPin }))
    } catch (e) {
      setError((e as Error).message)
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  const press = (d: string) => {
    if (busy) return
    if (d === '⌫') return setPin((p) => p.slice(0, -1))
    if (pin.length >= PIN_LENGTH) return
    const next = pin + d
    setPin(next)
    if (next.length === PIN_LENGTH) void submit(next)
  }

  if (status) {
    const cls = status.status === 'Granted' ? 'ok' : status.status === 'Denied' ? 'bad' : 'wait'
    return (
      <div className={`kiosk kiosk-result ${cls}`}>
        <div className="kiosk-icon">{status.status === 'Granted' ? '✓' : status.status === 'Denied' ? '✕' : '⏳'}</div>
        <h1>Kho {status.unitCode}</h1>
        <p className="kiosk-msg">{status.message}</p>
        {status.status === 'Pending' && <p className="muted">Đang chờ nhân viên xác nhận danh tính…</p>}
        <button className="btn ghost" onClick={reset}>Quay lại</button>
      </div>
    )
  }

  return (
    <div className="kiosk">
      <h1>Ra vào kho</h1>
      {step === 'unit' ? (
        <form
          className="kiosk-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (unitCode.trim()) setStep('pin')
          }}
        >
          <label>Nhập mã kho của bạn</label>
          <input
            className="kiosk-input"
            autoFocus
            value={unitCode}
            onChange={(e) => setUnitCode(e.target.value)}
            placeholder="VD: B-01"
          />
          <button className="btn primary big" type="submit">Tiếp tục</button>
        </form>
      ) : (
        <div className="kiosk-form">
          <label>Nhập mã PIN cho kho {unitCode.toUpperCase()}</label>
          <div className="pin-dots">
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <span key={i} className={i < pin.length ? 'filled' : ''} />
            ))}
          </div>
          {error && <p className="error">{error}</p>}
          <div className="pinpad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) =>
              d ? (
                <button key={i} onClick={() => press(d)} disabled={busy}>{d}</button>
              ) : (
                <span key={i} />
              ),
            )}
          </div>
          <button className="btn ghost" onClick={reset}>Đổi mã kho</button>
        </div>
      )}
    </div>
  )
}
