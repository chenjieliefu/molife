export type StationRole = 'owner' | 'member'

export type StationMembership = {
  token: string
  stationId: string
  memberId: string
  stationName: string
  departureTime: string
  stationCode: string
  nickname: string
  role: StationRole
}

export function normalizeInviteCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

export function isValidInviteCode(value: string): boolean {
  return /^[A-Z0-9]{6}$/.test(normalizeInviteCode(value))
}

export function readMembership(): StationMembership | null {
  try {
    const raw = localStorage.getItem('molife-membership')
    if (!raw) return null
    const membership = JSON.parse(raw) as StationMembership
    if (!membership.token || !membership.stationId || !membership.memberId || !membership.stationName || !membership.departureTime || !membership.stationCode) return null
    return membership
  } catch {
    return null
  }
}

export function clearMembership(): void {
  localStorage.removeItem('molife-membership')
}

export function saveMembership(membership: StationMembership): void {
  localStorage.setItem('molife-membership', JSON.stringify(membership))
  localStorage.setItem('molife-station', membership.stationName)
  localStorage.setItem('molife-time', membership.departureTime)
}
