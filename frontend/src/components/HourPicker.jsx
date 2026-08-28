// Preset buttons plus a fine slider, both snapping to the 15-minute
// minimum (Section 6). Kept deliberately simple — no typing a number.
const PRESETS = [0.25, 1, 8]

function fmtHours(h) {
  const whole = Math.floor(h)
  const frac = h - whole
  const fracLabel = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : ''
  if (whole === 0 && fracLabel) return fracLabel
  return whole + (fracLabel ? ' ' + fracLabel : '')
}

export default function HourPicker({ value, onChange, max = 12 }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {PRESETS.map(p => (
          <button
            key={p}
            className="btn"
            style={{
              flex: 1, background: value === p ? 'var(--accent)' : 'var(--bg3)',
              color: value === p ? '#fff' : 'var(--text)', fontSize: 15,
            }}
            onClick={() => onChange(p)}
          >
            {p === 0.25 ? '15 min' : `${p} hr${p > 1 ? 's' : ''}`}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <input
          type="range" min={0} max={max} step={0.25} value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{ flex: 1, height: 40 }}
        />
        <div style={{
          minWidth: 56, textAlign: 'center', fontWeight: 700, fontSize: 18,
          background: 'var(--accent-tint)', color: 'var(--accent)', borderRadius: 8, padding: '8px 4px',
        }}>
          {fmtHours(value)}
        </div>
      </div>
    </div>
  )
}
