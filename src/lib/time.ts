export function secondsUntil(target: string, now = new Date()): number {
  const [hours, minutes] = target.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0

  const departure = new Date(now)
  departure.setHours(hours, minutes, 0, 0)
  if (departure.getTime() < now.getTime()) departure.setDate(departure.getDate() + 1)

  return Math.max(0, Math.floor((departure.getTime() - now.getTime()) / 1000))
}

export function formatCountdown(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60

  if (hours > 0) return `${hours}小时 ${String(minutes).padStart(2, '0')}分`
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

export function readableDate(date = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date)
}

