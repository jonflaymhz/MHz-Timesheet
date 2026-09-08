import { useEffect } from 'react'

// autoFocus only fires the moment an input mounts, and browsers silently drop
// that focus() call if the tab/window doesn't have OS focus yet (e.g. a link
// opened in a background tab, or the window was minimised while the page
// loaded). This re-applies focus once the tab actually becomes visible/active,
// but only when nothing else is focused, so it never steals focus from a
// field the user has already clicked or tabbed into.
export function useAutofocusOnVisible(inputRef, active = true) {
  useEffect(() => {
    if (!active) return
    function refocus() {
      const el = inputRef.current
      if (!el) return
      const nothingFocused = !document.activeElement || document.activeElement === document.body
      if (document.visibilityState === 'visible' && nothingFocused) {
        el.focus()
      }
    }
    refocus()
    document.addEventListener('visibilitychange', refocus)
    window.addEventListener('focus', refocus)
    return () => {
      document.removeEventListener('visibilitychange', refocus)
      window.removeEventListener('focus', refocus)
    }
  }, [inputRef, active])
}
