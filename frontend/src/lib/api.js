// Session lives in an httpOnly cookie (Section 2: separate auth, separate
// cookies, no shared token with QW) — every request just needs
// credentials: 'include', no Authorization header to manage.
const BASE = '/api'

// Kiosk device token (Security Fixes v1.1 A3): set on a browser a System
// admin registered as a kiosk, sent on every request; the server only acts
// on it for the tile list and PIN login.
const KIOSK_KEY = 'mhz_ts_kiosk_device'
export function getKioskToken() {
  try { return localStorage.getItem(KIOSK_KEY) } catch { return null }
}
export function setKioskToken(token) {
  try { token ? localStorage.setItem(KIOSK_KEY, token) : localStorage.removeItem(KIOSK_KEY) } catch {}
}

async function request(method, path, body) {
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  const kiosk = getKioskToken()
  if (kiosk) headers['X-Kiosk-Device'] = kiosk
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.status = res.status
    err.body = data
    throw err
  }
  return data
}

export const api = {
  get:    (path)       => request('GET', path),
  post:   (path, body) => request('POST', path, body),
  patch:  (path, body) => request('PATCH', path, body),
  delete: (path)        => request('DELETE', path),
}
