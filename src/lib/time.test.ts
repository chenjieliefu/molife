import { describe, expect, it } from 'vitest'
import { formatCountdown, secondsUntil } from './time'

describe('time helpers', () => {
  it('counts down to the selected station time', () => {
    const now = new Date('2026-09-01T18:00:00+08:00')
    expect(secondsUntil('18:30', now)).toBe(1800)
  })

  it('formats both short and long countdowns', () => {
    expect(formatCountdown(125)).toBe('02:05')
    expect(formatCountdown(3660)).toBe('1小时 01分')
  })
})
