// Small inline icons. Decorative: buttons that use them carry aria-label.
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }

export const ChevronLeft = (p) => <svg {...base} {...p}><path d="M15 18l-6-6 6-6" /></svg>
export const ChevronRight = (p) => <svg {...base} {...p}><path d="M9 18l6-6-6-6" /></svg>
export const ChevronDown = (p) => <svg {...base} {...p}><path d="M6 9l6 6 6-6" /></svg>
export const Close = (p) => <svg {...base} {...p}><path d="M18 6L6 18M6 6l12 12" /></svg>
export const Check = (p) => <svg {...base} strokeWidth={3} width={16} height={16} {...p}><path d="M20 6L9 17l-5-5" /></svg>
export const Plus = (p) => <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
export const Lock = (p) => <svg {...base} width={18} height={18} {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
export const Backspace = (p) => <svg {...base} width={26} height={26} {...p}><path d="M21 5H9l-7 7 7 7h12a1 1 0 001-1V6a1 1 0 00-1-1z" /><path d="M17 9l-6 6M11 9l6 6" /></svg>
export const CalendarWeek = (p) => <svg {...base} {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
export const Clock = (p) => <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
export const People = (p) => <svg {...base} {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M21.5 20a6.5 6.5 0 00-4-6" /></svg>
export const Cog = (p) => <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>
