export type RectLike = {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export function ticketOverlapsScanner(ticket: RectLike, scanner: RectLike, threshold = 0.12): boolean {
  const overlapX = Math.max(0, Math.min(scanner.right, ticket.right) - Math.max(scanner.left, ticket.left))
  const overlapY = Math.max(0, Math.min(scanner.bottom + 38, ticket.bottom) - Math.max(scanner.top - 24, ticket.top))
  const ticketArea = ticket.width * ticket.height
  return ticketArea > 0 && (overlapX * overlapY) / ticketArea > threshold
}

