import { useEffect, useState } from 'react'

// Desktop grid from 900px wide; below that the phone layout (Employee UI
// Redesign v1.0 §5).
const QUERY = '(min-width: 900px)'

export function useIsDesktop() {
  const [desk, setDesk] = useState(() => typeof window !== 'undefined' && window.matchMedia(QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const on = () => setDesk(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return desk
}
