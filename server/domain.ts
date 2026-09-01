import type { MemberDto, StationDto, StationRole, TicketDto } from '../src/shared/contracts.js'

export type StationRecord = StationDto & {
  createdAt: string
}

export type MemberRecord = MemberDto & {
  stationId: string
  accessToken: string
  createdAt: string
}

export type SessionRecord = {
  station: StationRecord
  member: MemberRecord
}

export type SummaryRecord = {
  id: string
  stationId: string
  memberId: string
  workDate: string
  sourceText: string
  completed: string
  progress: string
  tomorrow: string
  provider: 'deepseek' | 'local' | 'local-fallback'
  warning?: string
  createdAt: string
  updatedAt: string
}

export type TicketRecord = TicketDto & {
  stationId: string
  memberId: string
  summaryId: string | null
  createdAt: string
}

export type DrawRecord = {
  id: string
  stationId: string
  workDate: string
  leaderMemberIds: string[]
  createdAt: string
}

export type CreateStationInput = {
  name: string
  departureTime: string
  timezone: string
  nickname: string
}

export type JoinStationInput = {
  code: string
  nickname: string
}

export type CreateMemberInput = {
  stationId: string
  nickname: string
  role: StationRole
}
