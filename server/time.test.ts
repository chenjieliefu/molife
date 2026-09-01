import { describe, expect, it } from 'vitest'
import { dateInTimeZone, stationHasDeparted, timeInTimeZone } from './time.js'

describe('station time', () => {
  const now = new Date('2026-09-01T10:31:00.000Z')

  it('uses the station timezone for its work date and time', () => {
    expect(dateInTimeZone('Asia/Shanghai', now)).toBe('2026-09-01')
    expect(timeInTimeZone('Asia/Shanghai', now)).toBe('18:31')
  })

  it('knows when a station has reached departure time', () => {
    expect(stationHasDeparted('18:30', 'Asia/Shanghai', now)).toBe(true)
    expect(stationHasDeparted('19:00', 'Asia/Shanghai', now)).toBe(false)
  })
})
