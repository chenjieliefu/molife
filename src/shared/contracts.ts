export type StationRole = 'owner' | 'member'

export type StationDto = {
  id: string
  code: string
  name: string
  departureTime: string
  timezone: string
  memberCount: number
}

export type MemberDto = {
  id: string
  nickname: string
  role: StationRole
}

export type SessionDto = {
  token: string
  station: StationDto
  member: MemberDto
}

export type WorkSummaryDto = {
  id: string
  completed: string
  progress: string
  tomorrow: string
  provider: 'deepseek' | 'local' | 'local-fallback'
  warning?: string
}

export type GeneratedSummaryDto = Omit<WorkSummaryDto, 'id'>

export type TicketDto = {
  id: string
  workDate: string
  departureTime: string
  stationName: string
  seat: string
  checkedInAt: string | null
}

export type LobbyMemberDto = {
  id: string
  nickname: string
  checkedIn: boolean
  isLeader: boolean
}

export type LobbyDto = {
  workDate: string
  departureTime: string
  departed: boolean
  checkedInCount: number
  members: LobbyMemberDto[]
  leaders: MemberDto[]
  preview: boolean
}

export type JourneyDto = {
  totalOnTimeDepartures: number
  tickets: TicketDto[]
}

export type ApiError = {
  error: {
    code: string
    message: string
  }
}
