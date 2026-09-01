import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { LobbyDto, SessionDto, TicketDto, WorkSummaryDto } from '../src/shared/contracts.js'
import { buildApp } from './app.js'
import type { Summarizer } from './summarizer.js'

const fakeSummarizer: Summarizer = {
  async summarize() {
    return {
      completed: '完成了首页联调。',
      progress: '多人车站正在推进。',
      tomorrow: '明天继续验证抽选流程。',
      provider: 'local',
    }
  },
}

describe('Molife API', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    app = await buildApp({
      config: {
        host: '127.0.0.1',
        port: 0,
        databasePath: ':memory:',
        aiModel: 'deepseek-v4-flash',
        aiBaseUrl: 'https://api.deepseek.com',
        serveStatic: false,
      },
      summarizer: fakeSummarizer,
    })
  })

  afterEach(async () => app.close())

  const auth = (token: string) => ({ authorization: `Bearer ${token}` })

  it('creates a shared station and lets coworkers join it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/stations',
      payload: { name: '产品站', departureTime: '18:30', nickname: '小莫', timezone: 'Asia/Shanghai' },
    })
    expect(created.statusCode).toBe(201)
    const owner = created.json<SessionDto>()
    expect(owner.station.code).toHaveLength(6)
    expect(owner.member.role).toBe('owner')

    const lookup = await app.inject({ method: 'GET', url: `/api/stations/lookup/${owner.station.code}` })
    expect(lookup.statusCode).toBe(200)
    expect(lookup.json<SessionDto['station']>().name).toBe('产品站')

    const joined = await app.inject({ method: 'POST', url: '/api/stations/join', payload: { code: owner.station.code, nickname: '夏夏' } })
    expect(joined.statusCode).toBe(201)
    const member = joined.json<SessionDto>()
    expect(member.station.id).toBe(owner.station.id)
    expect(member.member.role).toBe('member')

    const memberUpdate = await app.inject({
      method: 'PATCH',
      url: '/api/stations/current',
      headers: auth(member.token),
      payload: { name: '偷偷改名', departureTime: '17:00' },
    })
    expect(memberUpdate.statusCode).toBe(403)
  })

  it('connects summary, ticket, check-in, lobby and deterministic preview draw', async () => {
    const owner = (await app.inject({
      method: 'POST',
      url: '/api/stations',
      payload: { name: '设计站', departureTime: '23:59', nickname: '小莫' },
    })).json<SessionDto>()

    const summaryResponse = await app.inject({
      method: 'POST',
      url: '/api/summaries/generate',
      headers: auth(owner.token),
      payload: { sourceText: '今天完成了首页联调。' },
    })
    expect(summaryResponse.statusCode).toBe(200)
    const generated = summaryResponse.json<Omit<WorkSummaryDto, 'id'>>()
    expect(generated.completed).toContain('首页')

    const summary = (await app.inject({
      method: 'PUT',
      url: '/api/summaries/today',
      headers: auth(owner.token),
      payload: { sourceText: '今天完成了首页联调。', ...generated },
    })).json<WorkSummaryDto>()

    const firstTicketResponse = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: auth(owner.token),
      payload: { summaryId: summary.id },
    })
    const ticket = firstTicketResponse.json<TicketDto>()
    expect(ticket.checkedInAt).toBeNull()

    const duplicateTicket = (await app.inject({ method: 'POST', url: '/api/tickets', headers: auth(owner.token), payload: {} })).json<TicketDto>()
    expect(duplicateTicket.id).toBe(ticket.id)

    const checkedTicket = (await app.inject({
      method: 'POST',
      url: `/api/tickets/${ticket.id}/checkin`,
      headers: auth(owner.token),
    })).json<TicketDto>()
    expect(checkedTicket.checkedInAt).toBeTruthy()

    for (const nickname of ['夏夏', '阿哲']) {
      const coworker = (await app.inject({ method: 'POST', url: '/api/stations/join', payload: { code: owner.station.code, nickname } })).json<SessionDto>()
      const coworkerTicket = (await app.inject({ method: 'POST', url: '/api/tickets', headers: auth(coworker.token), payload: {} })).json<TicketDto>()
      await app.inject({ method: 'POST', url: `/api/tickets/${coworkerTicket.id}/checkin`, headers: auth(coworker.token) })
    }

    const lobby = (await app.inject({ method: 'GET', url: '/api/lobby', headers: auth(owner.token) })).json<LobbyDto>()
    expect(lobby.checkedInCount).toBe(3)

    const previewOne = (await app.inject({ method: 'POST', url: '/api/lobby/draw', headers: auth(owner.token), payload: { preview: true } })).json<LobbyDto>()
    const previewTwo = (await app.inject({ method: 'POST', url: '/api/lobby/draw', headers: auth(owner.token), payload: { preview: true } })).json<LobbyDto>()
    expect(previewOne.leaders.map((leader) => leader.id)).toEqual(previewTwo.leaders.map((leader) => leader.id))
    expect(previewOne.leaders.length).toBeGreaterThanOrEqual(2)
  })
})
