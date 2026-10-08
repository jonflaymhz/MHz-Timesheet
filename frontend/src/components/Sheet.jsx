import { useEffect, useRef } from 'react'
import { Close } from './Icons.jsx'

// Bottom sheet on a phone, centred dialog from 900px up (Employee UI
// Redesign v1.0 §3, §4): same content either way, only the CSS differs.
export default function Sheet({ title, subtitle, onClose, children, labelledBy = 'sheet-title' }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const prevFocus = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [])

  return (
    <div className="sheet-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={ref}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <div>
            <h2 id={labelledBy}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Close /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
