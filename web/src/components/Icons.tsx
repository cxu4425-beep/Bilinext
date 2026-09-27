type P = { className?: string; filled?: boolean }

const base = 'w-5 h-5'
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const Home = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
  </svg>
)

export const Fire = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <path d="M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-1.5.6-2.8 1.4-3.8C9 10.5 10 12 11 12c0-3 1-6 1-9Z" />
  </svg>
)

export const Users = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
    <path d="M16 5.2A3.2 3.2 0 0 1 16 11" />
    <path d="M18 14.8c2 .8 3 2.7 3 5.2" />
  </svg>
)

export const Star = ({ className = base, filled }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke} fill={filled ? 'currentColor' : 'none'}>
    <path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9Z" />
  </svg>
)

export const Bell = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z" />
    <path d="M10.5 20a2 2 0 0 0 3 0" />
  </svg>
)

export const Search = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m20 20-4.4-4.4" />
  </svg>
)

export const Upload = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <path d="M12 16V4" />
    <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
  </svg>
)

export const ThumbUp = ({ className = base, filled }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke} fill={filled ? 'currentColor' : 'none'}>
    <path d="M7 21V10l4.2-7a2 2 0 0 1 2.9 2.4L13 9h5.6a2 2 0 0 1 2 2.4l-1.4 7A2.5 2.5 0 0 1 16.7 21Z" />
    <path d="M7 10H4v11h3" />
  </svg>
)

export const ThumbDown = ({ className = base, filled }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke} fill={filled ? 'currentColor' : 'none'}>
    <path d="M17 3v11l-4.2 7a2 2 0 0 1-2.9-2.4L11 15H5.4a2 2 0 0 1-2-2.4l1.4-7A2.5 2.5 0 0 1 7.3 3Z" />
    <path d="M17 14h3V3h-3" />
  </svg>
)

export const Coin = ({ className = base, filled }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke} fill={filled ? 'currentColor' : 'none'}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v9M9 10.5h6M9 13.5h6" stroke={filled ? 'var(--bg)' : 'currentColor'} />
  </svg>
)

export const Share = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <circle cx="18" cy="5.5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="18.5" r="2.5" />
    <path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1" />
  </svg>
)

export const Comment = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <path d="M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.3A7.5 7.5 0 1 1 20 12Z" />
  </svg>
)

export const Poll = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <path d="M5 20V10M12 20V4M19 20v-6" />
  </svg>
)

export const Image = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <circle cx="8.5" cy="10" r="1.5" />
    <path d="m4.5 17 4.7-4.3a1.5 1.5 0 0 1 2 0L16 17" />
  </svg>
)

export const Smile = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.8 14.2a4 4 0 0 0 6.4 0" />
    <path d="M9 9.5h.01M15 9.5h.01" strokeWidth="2.4" />
  </svg>
)

export const Clock = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </svg>
)

export const Send = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <path d="M4.5 12 20 4.5 15.5 20l-4-6.5Z" />
    <path d="m11.5 13.5 8.5-9" />
  </svg>
)

export const Close = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
)

export const Sun = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </svg>
)

export const Moon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </svg>
)

export const History = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...stroke}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.5 4.5V9H8" />
    <path d="M12 8v4.3l2.8 1.7" />
  </svg>
)
