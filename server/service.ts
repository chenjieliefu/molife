import { createHash, randomInt } from 'node:crypto'
import type { GeneratedSummaryDto, JourneyDto, LobbyDto, MemberDto, SessionDto, StationDto, TicketDto, WorkSummaryDto } from '../src/shared/contracts.js'
import type { SessionRecord } from './domain.js'
import type { Summarizer } from './summarizer.js'
import { MolifeStore } from './store.js'
import { dateInTimeZone, stationHasDeparted } from './time.js'

export class MolifeError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 400) {
    super(message)
  }
}

function toStationDto(session: SessionRecord): StationDto {
  const { createdAt: _, ...station } = session.station
  return station
}

function toMemberDto(session: SessionRecord): MemberDto {
  return { id: session.member.id, nickname: session.member.nickname, role: session.member.role }
}

function toSessionDto(session: SessionRecord): SessionDto {
  return { token: session.member.accessToken, station: toStationDto(session), member: toMemberDto(session) }
}

function chooseRandom<T>(items: T[], count: number): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1)
    ;[copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]]
  }
  return copy.slice(0, count)
}

function leaderCount(participantCount: number, seed?: string): number {
  if (participantCount <= 2) return participantCount
  if (seed) return 2 + (createHash('sha256').update(seed).digest()[0] % 2)
  return 2 + randomInt(2)
}

export class MolifeService {
  constructor(private readonly store: MolifeStore, private readonly summarizer: Summarizer) {}

  createStation(input: { name: string; departureTime: string; nickname: string; timezone?: string }): SessionDto {
    const session = this.store.createStationWithOwner({
      name: input.name,
      departureTime: input.departureTime,
      nickname: input.nickname,
      timezone: input.timezone || 'Asia/Shanghai',
    })
    return toSessionDto(session)
  }

  joinStation(input: { code: string; nickname: string }): SessionDto {
    const session = this.store.joinStation(input.code.toUpperCase(), input.nickname)
    if (!session) throw new MolifeError('station_not_found', '没有找到这个车站，请检查邀请码。', 404)
    return toSessionDto(session)
  }

  lookupStation(code: string): StationDto {
    const station = this.store.getStationByCode(code.toUpperCase())
    if (!station) throw new MolifeError('station_not_found', '没有找到这个车站，请检查邀请码。', 404)
    const { createdAt: _, ...dto } = station
    return dto
  }

  getSession(token: string): SessionDto {
    return toSessionDto(this.requireSession(token))
  }

  updateStation(token: string, input: { name: string; departureTime: string }): StationDto {
    const session = this.requireSession(token)
    if (session.member.role !== 'owner') throw new MolifeError('owner_required', '只有站长可以修改车站设置。', 403)
    const station = this.store.updateStation(session.station.id, input.name, input.departureTime)
    const { createdAt: _, ...dto } = station
    return dto
  }

  async generateSummary(token: string, sourceText: string): Promise<GeneratedSummaryDto> {
    this.requireSession(token)
    const result = await this.summarizer.summarize(sourceText)
    return result
  }

  saveSummary(token: string, input: { sourceText: string; completed: string; progress: string; tomorrow: string; provider: WorkSummaryDto['provider']; warning?: string }): WorkSummaryDto {
    const session = this.requireSession(token)
    const workDate = dateInTimeZone(session.station.timezone)
    const record = this.store.upsertSummary({
      stationId: session.station.id,
      memberId: session.member.id,
      workDate,
      sourceText: input.sourceText,
      completed: input.completed,
      progress: input.progress,
      tomorrow: input.tomorrow,
      provider: input.provider,
      warning: input.warning,
    })
    return {
      id: record.id,
      completed: record.completed,
      progress: record.progress,
      tomorrow: record.tomorrow,
      provider: record.provider,
      warning: record.warning,
    }
  }

  issueTicket(token: string, summaryId?: string): TicketDto {
    const session = this.requireSession(token)
    if (summaryId && !this.store.hasMemberSummary(summaryId, session.member.id)) {
      throw new MolifeError('summary_not_found', '没有找到这份工作总结。', 404)
    }
    const workDate = dateInTimeZone(session.station.timezone)
    const { stationId: _, memberId: __, summaryId: ___, createdAt: ____, ...ticket } = this.store.issueTicket(session, workDate, summaryId || null)
    return ticket
  }

  checkIn(token: string, ticketId: string): TicketDto {
    const session = this.requireSession(token)
    const record = this.store.checkInTicket(ticketId, session.member.id)
    if (!record) throw new MolifeError('ticket_not_found', '没有找到这张车票。', 404)
    const { stationId: _, memberId: __, summaryId: ___, createdAt: ____, ...ticket } = record
    return ticket
  }

  getLobby(token: string): LobbyDto {
    const session = this.requireSession(token)
    const workDate = dateInTimeZone(session.station.timezone)
    const departed = stationHasDeparted(session.station.departureTime, session.station.timezone)
    if (departed && !this.store.getDraw(session.station.id, workDate)) this.createActualDraw(session, workDate)
    return this.buildLobby(session, workDate, false)
  }

  draw(token: string, preview: boolean): LobbyDto {
    const session = this.requireSession(token)
    const workDate = dateInTimeZone(session.station.timezone)
    if (preview) return this.buildPreviewLobby(session, workDate)
    if (!stationHasDeparted(session.station.departureTime, session.station.timezone)) {
      throw new MolifeError('departure_not_reached', '还没有到约定下班时间。', 409)
    }
    this.createActualDraw(session, workDate)
    return this.buildLobby(session, workDate, false)
  }

  getJourney(token: string): JourneyDto {
    const session = this.requireSession(token)
    const records = this.store.listTickets(session.member.id)
    return {
      totalOnTimeDepartures: records.filter((ticket) => ticket.checkedInAt).length,
      tickets: records.map(({ stationId: _, memberId: __, summaryId: ___, createdAt: ____, ...ticket }) => ticket),
    }
  }

  private requireSession(token: string): SessionRecord {
    const session = this.store.getSessionByToken(token)
    if (!session) throw new MolifeError('unauthorized', '登录状态已失效，请重新加入车站。', 401)
    return session
  }

  private createActualDraw(session: SessionRecord, workDate: string): void {
    if (this.store.getDraw(session.station.id, workDate)) return
    const participants = this.store.listLobbyMembers(session.station.id, workDate).filter((member) => member.checkedIn)
    const leaders = chooseRandom(participants, leaderCount(participants.length))
    this.store.saveDraw(session.station.id, workDate, leaders.map((member) => member.id))
  }

  private buildLobby(session: SessionRecord, workDate: string, preview: boolean): LobbyDto {
    const members = this.store.listLobbyMembers(session.station.id, workDate)
    const draw = this.store.getDraw(session.station.id, workDate)
    const leaderIds = draw?.leaderMemberIds || []
    return {
      workDate,
      departureTime: session.station.departureTime,
      departed: Boolean(draw),
      checkedInCount: members.filter((member) => member.checkedIn).length,
      members: members.map((member) => ({
        id: member.id,
        nickname: member.nickname,
        checkedIn: member.checkedIn,
        isLeader: leaderIds.includes(member.id),
      })),
      leaders: members.filter((member) => leaderIds.includes(member.id)).map((member) => ({ id: member.id, nickname: member.nickname, role: member.role })),
      preview,
    }
  }

  private buildPreviewLobby(session: SessionRecord, workDate: string): LobbyDto {
    const members = this.store.listLobbyMembers(session.station.id, workDate)
    const participants = members.filter((member) => member.checkedIn)
    const seed = `${session.station.id}:${workDate}`
    const sorted = [...participants].sort((left, right) => {
      const leftHash = createHash('sha256').update(`${seed}:${left.id}`).digest('hex')
      const rightHash = createHash('sha256').update(`${seed}:${right.id}`).digest('hex')
      return leftHash.localeCompare(rightHash)
    })
    const selected = sorted.slice(0, leaderCount(sorted.length, seed))
    const leaderIds = selected.map((member) => member.id)
    return {
      workDate,
      departureTime: session.station.departureTime,
      departed: false,
      checkedInCount: participants.length,
      members: members.map((member) => ({ id: member.id, nickname: member.nickname, checkedIn: member.checkedIn, isLeader: leaderIds.includes(member.id) })),
      leaders: selected.map((member) => ({ id: member.id, nickname: member.nickname, role: member.role })),
      preview: true,
    }
  }
}
