import { describe, expect, it } from 'vitest'
import { isValidInviteCode, normalizeInviteCode } from './station'

describe('station invite helpers', () => {
  it('normalizes user-entered invite codes', () => {
    expect(normalizeInviteCode(' li-fe 8_8 ')).toBe('LIFE88')
  })

  it('only accepts six-character station codes', () => {
    expect(isValidInviteCode('LIFE88')).toBe(true)
    expect(isValidInviteCode('LIFE8')).toBe(false)
  })
})
