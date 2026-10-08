import { weekdayName, fmtShort } from '../lib/dates.js'
import { fmtH, lineKey, entryTitle, entrySubtitle } from '../lib/week.js'
import { Check, ChevronDown, Plus } from './Icons.jsx'

const STATE_WORDS = { complete: 'Complete', short: 'Short', missing: 'Needs hours', weekend: 'Weekend', off: 'Not working' }

function Badge({ state }) {
  const glyph = state === 'complete' ? <Check /> : state === 'short' || state === 'missing' ? '!' : '–'
  return (
    <span className={`badge badge-${state}`}>
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>{glyph}</span>
      <span className="sr-only">{STATE_WORDS[state]}</span>
    </span>
  )
}

// One day of the phone week (Employee UI Redesign v1.0 §2): tap to open,
// entries inside, Add time plus Not working (empty day) or Absence (short
// day). Read-only weeks open to show entries with no actions.
export default function DayCard({ day, open, onToggle, editable, colours, weekOwnerId, onAdd, onEdit, onAbsence, onRemoveMarker }) {
  const { date, state, note, total, work, marker } = day
  const bodyId = `day-body-${date}`
  return (
    <section className={`day${open ? ' open' : ''}`} id={`day-${date}`} aria-label={`${weekdayName(date)} ${fmtShort(date)}`}>
      <button type="button" className="day-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <Badge state={state} />
        <span style={{ minWidth: 0 }}>
          <span className="day-title" style={{ display: 'block' }}>{weekdayName(date)} {fmtShort(date)}</span>
          <span className={`day-note ${state === 'short' ? 'short' : state === 'missing' ? 'missing' : ''}`} style={{ display: 'block' }}>{note}</span>
        </span>
        <span className={`day-total${total > 0 ? '' : ' zero'}`}>{fmtH(total)} h</span>
        <ChevronDown className="chev" />
      </button>

      {open && (
        <div className="day-body" id={bodyId}>
          {work.map(e => {
            const proxy = weekOwnerId && e.entered_by !== weekOwnerId
            const inner = (
              <>
                <span className="dot" style={{ background: colours.get(lineKey(e)) }} />
                <span className="entry-main">
                  <span className="entry-name" style={{ display: 'block' }}>{entryTitle(e)}</span>
                  <span className="entry-sub" style={{ display: 'block' }}>
                    {entrySubtitle(e)}
                    {proxy && <span style={{ color: 'var(--warn-text)', fontWeight: 600 }}> · entered by {e.entered_by_name || 'supervisor'}</span>}
                  </span>
                </span>
                <span className="entry-hours">{fmtH(e.hours)} h</span>
              </>
            )
            return editable
              ? <button key={e.id} type="button" className="entry" onClick={() => onEdit(e)} aria-label={`Edit ${entryTitle(e)}, ${fmtH(e.hours)} hours`}>{inner}</button>
              : <div key={e.id} className="entry">{inner}</div>
          })}
          {marker && (
            <div className="entry">
              <span className="dot" style={{ background: 'var(--dot-abs)' }} />
              <span className="entry-main">
                <span className="entry-name" style={{ display: 'block' }}>{entryTitle(marker)}</span>
                {marker.description && <span className="entry-sub" style={{ display: 'block' }}>{marker.description}</span>}
              </span>
              {editable
                ? <button type="button" className="btn-link" onClick={() => onRemoveMarker(marker)}>Remove</button>
                : <span className="entry-hours">0 h</span>}
            </div>
          )}
          {!work.length && !marker && !editable && <div className="entry" style={{ color: 'var(--muted)' }}>Nothing booked.</div>}

          {editable && (
            <div className="day-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onAdd}><Plus width={18} height={18} />Add time</button>
              {state === 'missing' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAbsence(0)}>Not working</button>}
              {state === 'short' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAbsence(day.shortBy)}>Absence</button>}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
