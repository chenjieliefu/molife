import { describe, expect, it } from 'vitest'
import { ticketOverlapsScanner } from './checkin'

const scanner = { top: 100, right: 300, bottom: 210, left: 50, width: 250, height: 110 }

describe('ticketOverlapsScanner', () => {
  it('accepts a ticket visibly inserted into the scanner', () => {
    const ticket = { top: 170, right: 280, bottom: 330, left: 70, width: 210, height: 160 }
    expect(ticketOverlapsScanner(ticket, scanner)).toBe(true)
  })

  it('rejects a ticket dropped away from the scanner', () => {
    const ticket = { top: 350, right: 280, bottom: 510, left: 70, width: 210, height: 160 }
    expect(ticketOverlapsScanner(ticket, scanner)).toBe(false)
  })
})
