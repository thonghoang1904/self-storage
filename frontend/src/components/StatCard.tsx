import { Icon } from './ui'

/**
 * A number card at the top of a list page. With onClick it becomes a filter button: clicking shows the rows it counts
 * (the page decides how), and the active card is outlined.
 */
export function StatCard({ icon, tone, label, value, note, active = false, onClick }: {
  icon: string; tone: string; label: string; value: string | number; note: string; active?: boolean; onClick?: () => void
}) {
  const body = (
    <>
      <div className="row between"><span className="muted">{label}</span><span className={`stat-icon ${tone}`}><Icon name={icon} size={17} /></span></div>
      <b className="stat-value">{value}</b>
      <small className={`stat-note ${tone}`}>{note}</small>
    </>
  )
  if (!onClick) return <div className="stat-card">{body}</div>
  return <button type="button" className={`stat-card stat-filter ${active ? 'active' : ''}`} aria-pressed={active} onClick={onClick}>{body}</button>
}

/** Scrolls the list a card filters into view, after React has re-rendered it. */
export const scrollToList = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
