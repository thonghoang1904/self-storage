import type { ReactNode } from 'react'
import { statusOf } from '../types'

// ------------------------------------------------------------------ icons (stroke icons, 24x24 grid)

const ICONS: Record<string, ReactNode> = {
  circleX: <><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  package: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  card: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></>,
  thermo: <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />,
  idCard: <><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="8" cy="12" r="2.5" /><path d="M14 10h4M14 14h4M5 16.5c.6-1.2 1.7-2 3-2s2.4.8 3 2" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  login: <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17 5-5-5-5M15 12H3" /></>,
  alert: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4M12 17h.01" /></>,
  pin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>,
  clipboard: <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="m9 14 2 2 4-4" /></>,
  arrowRight: <path d="M5 12h14m-7-7 7 7-7 7" />,
  eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M9.9 4.24A9 9 0 0 1 12 4c7 0 10 8 10 8a13 13 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 12s3 8 10 8a9.7 9.7 0 0 0 5.39-1.61" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24M2 2l20 20" /></>,
  door: <><path d="M13 4h3a2 2 0 0 1 2 2v14M2 20h3M13 20h9M10 12v.01" /><path d="M13 4.56v16.16a1 1 0 0 1-1.24.97L5 20V5.56a2 2 0 0 1 1.52-1.94l4-1A2 2 0 0 1 13 4.56Z" /></>,
  size: <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />,
  snow: <path d="M2 12h20M12 2v20m8-6-4-4 4-4M4 8l4 4-4 4M16 4l-4 4-4-4M8 20l4-4 4 4" />,
  history: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5M12 7v5l4 2" /></>,
  building: <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" /></>,
  scan: <path d="M3 7V5a2 2 0 0 1 2-2h2m10 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  key: <><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" /></>,
  wallet: <><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /></>,
  edit: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  trash: <><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" /></>,
  chart: <path d="M3 3v18h18M7 16v-4M12 16V8M17 16v-6" />,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  refresh: <><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></>,
}

export function Icon({ name, size = 18, className }: { name: keyof typeof ICONS | string; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

// ------------------------------------------------------------------ brand

/** `area` names the back-office section next to the brand (Admin, Operations, Facility); without it the logo is the public "SafeKeep Storage". */
export function Logo({ area, light = false }: { area?: string; light?: boolean }) {
  return (
    <span className={`logo ${light ? 'light' : ''}`}>
      {area ? <span className="logo-mark"><Icon name="circleX" size={18} /></span> : <Icon name="circleX" size={26} className="cyan" />}
      <span className="logo-text">SafeKeep <span className="cyan">{area ?? 'Storage'}</span></span>
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const s = statusOf(status)
  return <span className={`badge ${s.tone}`}>{s.label}</span>
}

export function Badge({ tone = 'info', children }: { tone?: 'ok' | 'warn' | 'bad' | 'info' | 'muted'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

export function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <span className={`eyebrow ${dark ? 'dark' : ''}`}><i />{children}</span>
}

export function Empty({ icon = 'package', children }: { icon?: string; children: ReactNode }) {
  return <div className="empty"><Icon name={icon} size={22} /><span>{children}</span></div>
}

/** Splits "Kho Nhỏ S (1.5m x 1.5m)" into the name and the size note. */
export function splitTypeName(typeName: string) {
  const m = typeName.match(/^(.*?)\s*\((.*)\)\s*$/)
  return m ? { name: m[1], size: m[2] } : { name: typeName, size: '' }
}

// ------------------------------------------------------------------ illustrations (stand-ins for the photos in Figma)

/** A storage unit with a roll-up door, drawn bigger for bigger unit types. */
export function UnitArt({ variant = 0, label, className }: { variant?: number; label?: string; className?: string }) {
  const v = Math.max(0, Math.min(3, variant))
  const doorW = [70, 110, 150, 196][v]
  const doorH = [70, 118, 132, 140][v]
  const x = 160 - doorW / 2
  const y = 170 - doorH
  const tints = ['#2b8fb0', '#3f6f8f', '#52627a', '#2f7a8a']
  return (
    <svg className={`unit-art ${className ?? ''}`} viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`wall${v}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9f1f4" /><stop offset="1" stopColor="#cfdde3" />
        </linearGradient>
        <linearGradient id={`door${v}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tints[v]} /><stop offset="1" stopColor="#1c2541" />
        </linearGradient>
      </defs>
      <rect width="320" height="200" fill={`url(#wall${v})`} />
      <rect y="170" width="320" height="30" fill="#b7c7cf" />
      <path d="M0 170h320" stroke="#9fb3bd" />
      {[40, 280].map((cx) => <rect key={cx} x={cx - 18} y="40" width="36" height="130" fill="#dbe6ea" stroke="#c3d3da" />)}
      <rect x={x - 6} y={y - 8} width={doorW + 12} height={doorH + 8} rx="3" fill="#8fa5b0" />
      <rect x={x} y={y} width={doorW} height={doorH} fill={`url(#door${v})`} />
      {Array.from({ length: Math.floor(doorH / 9) }, (_, i) => (
        <path key={i} d={`M${x} ${y + 9 * (i + 1)}h${doorW}`} stroke="#ffffff" strokeOpacity="0.14" />
      ))}
      <rect x={x + doorW / 2 - 9} y={y + doorH - 14} width="18" height="5" rx="2" fill="#00b4d8" />
      <rect x="146" y="14" width="28" height="10" rx="2" fill="#00b4d8" opacity="0.85" />
      {label && <text x={x + doorW / 2} y={y - 14} textAnchor="middle" fontSize="11" fontFamily="Manrope, sans-serif" fontWeight="700" fill="#1c2541">{label}</text>}
    </svg>
  )
}

/** One-point perspective corridor of storage doors, used in the hero panels. */
export function CorridorArt({ className }: { className?: string }) {
  const W = 400, H = 480, vx = 200, vy = 210
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  // depth t: 0 = front edge of the picture, 1 = vanishing point
  const wall = (side: -1 | 1, t: number) => ({ x: lerp(side < 0 ? 0 : W, vx, t), top: lerp(0, vy, t), bot: lerp(H, vy, t) })
  const doors: ReactNode[] = []
  const depths = [0.06, 0.3, 0.48, 0.61, 0.705, 0.775, 0.83, 0.87]
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < depths.length - 1; i++) {
      const a = wall(side, depths[i] + 0.02), b = wall(side, depths[i + 1] - 0.015)
      const topA = lerp(a.top, a.bot, 0.18), botA = lerp(a.top, a.bot, 0.9)
      const topB = lerp(b.top, b.bot, 0.18), botB = lerp(b.top, b.bot, 0.9)
      const fade = 1 - i / depths.length
      doors.push(
        <polygon key={`${side}${i}`} points={`${a.x},${topA} ${b.x},${topB} ${b.x},${botB} ${a.x},${botA}`}
          fill={i % 3 === 1 ? '#0e7490' : '#16405a'} opacity={0.35 + 0.6 * fade} stroke="#00b4d8" strokeOpacity={0.25 * fade} />,
      )
    }
  }
  return (
    <svg className={`corridor-art ${className ?? ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="glow" cx="0.5" cy="0.44" r="0.6">
          <stop offset="0" stopColor="#bfefff" stopOpacity="0.9" /><stop offset="0.25" stopColor="#3aa9c9" stopOpacity="0.35" /><stop offset="1" stopColor="#0b132b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="floor" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#5d6f80" /><stop offset="1" stopColor="#1c2541" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="#13203c" />
      <polygon points={`0,0 ${W},0 ${vx},${vy}`} fill="#1a2a48" />
      <polygon points={`0,${H} ${W},${H} ${vx},${vy}`} fill="url(#floor)" />
      <polygon points={`0,0 0,${H} ${vx},${vy}`} fill="#1d2f4e" />
      <polygon points={`${W},0 ${W},${H} ${vx},${vy}`} fill="#1b2c4a" />
      {doors}
      <polygon points={`${vx - 14},0 ${vx + 14},0 ${vx + 1},${vy} ${vx - 1},${vy}`} fill="#e9fbff" opacity="0.55" />
      <polygon points={`${vx - 30},${H} ${vx + 30},${H} ${vx + 1},${vy} ${vx - 1},${vy}`} fill="#ffffff" opacity="0.07" />
      <rect width={W} height={H} fill="url(#glow)" />
    </svg>
  )
}
