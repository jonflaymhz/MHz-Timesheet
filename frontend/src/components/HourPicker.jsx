// Preset buttons plus an hours/minutes stepper, both snapping to the
// 15-minute minimum (Section 6). Click-through only, no typing a number
// (usability feedback 2026-09-02, item 2 — replaces the previous slider).
const PRESETS = [0.25, 1, 8]

function fmtHours(h) {
  const whole = Math.floor(h)
  const frac = h - whole
  const fracLabel = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : ''
  if (whole === 0 && fracLabel) return fracLabel
  return whole + (fracLabel ? ' ' + fracLabel : '')
}

function StepperBox({ label, value, unit, onStep, disabled }) {
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button type="button" className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 18 }} onClick={() => onStep(-1)} disabled={disabled?.(-1)}>
          −
        </button>
        <div style={{
          flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 18,
          background: 'var(--accent-tint)', color: 'var(--accent)', borderRadius: 8, padding: '8px 4px',
        }}>
          {value}{unit}
        </div>
        <button type="button" className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 18 }} onClick={() => onStep(1)} disabled={disabled?.(1)}>
          +
        </button>
      </div>
    </div>
  )
}

export default function HourPicker({ value, onChange, max = 14 }) {
  const hours = Math.floor(value)
  const minutes = Math.round((value - hours) * 60)

  function stepHours(dir) {
    const next = Math.max(0, Math.min(max, hours + dir))
    onChange(Number((next + minutes / 60).toFixed(2)))
  }

  function stepMinutes(dir) {
    let h = hours
    let m = minutes + dir * 15
    if (m < 0) { m = 45; h = Math.max(0, h - 1) }
    if (m > 45) { m = 0; h = Math.min(max, h + 1) }
    onChange(Number((h + m / 60).toFixed(2)))
  }

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
      <div style={{ display: 'flex', gap: 16 }}>
        <StepperBox
          label="Hours" value={hours} unit="h" onStep={stepHours}
          disabled={dir => (dir < 0 ? hours === 0 : hours >= max)}
        />
        <StepperBox
          label="Minutes" value={minutes} unit="m" onStep={stepMinutes}
          disabled={dir => (dir < 0 ? hours === 0 && minutes === 0 : hours >= max && minutes >= 45)}
        />
      </div>
      <div style={{ textAlign: 'center', marginTop: 10, fontSize: 13, color: 'var(--text3)' }}>
        {fmtHours(value)} {value === 1 ? 'hour' : 'hours'} total
      </div>
    </div>
  )
}
