import fs from 'node:fs'
import path from 'node:path'
import fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import fastifyStatic from '@fastify/static'
import { z, ZodError, type ZodType } from 'zod'
import type { AppConfig } from './config.js'
import { MolifeError, MolifeService } from './service.js'
import { createSummarizer, type Summarizer } from './summarizer.js'
import { MolifeStore } from './store.js'

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '下班时间格式不正确。')
const nicknameSchema = z.string().trim().min(1).max(12)
const stationNameSchema = z.string().trim().min(1).max(24)

function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value)
}

function bearerToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) throw new MolifeError('unauthorized', '请先加入一个车站。', 401)
  return authorization.slice('Bearer '.length)
}

export type BuildAppOptions = {
  config: AppConfig
  summarizer?: Summarizer
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = fastify({ logger: process.env.NODE_ENV !== 'test' })
  const store = new MolifeStore(options.config.databasePath)
  const summarizer = options.summarizer || createSummarizer({ apiKey: options.config.aiApiKey, model: options.config.aiModel, baseURL: options.config.aiBaseUrl })
  const service = new MolifeService(store, summarizer)

  app.addHook('onClose', async () => store.close())

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof MolifeError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } })
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'invalid_input', message: error.issues[0]?.message || '输入内容不正确。' } })
    }
    app.log.error(error)
    return reply.status(500).send({ error: { code: 'internal_error', message: '服务暂时开小差了，请稍后再试。' } })
  })

  app.get('/api/health', async () => ({
    ok: true,
    aiConfigured: Boolean(options.config.aiApiKey),
    provider: options.config.aiApiKey ? 'deepseek' : 'local',
    model: options.config.aiApiKey ? options.config.aiModel : 'local',
  }))

  app.post('/api/stations', async (request, reply) => {
    const body = parse(z.object({
      name: stationNameSchema,
      departureTime: timeSchema,
      nickname: nicknameSchema,
      timezone: z.string().min(1).max(64).default('Asia/Shanghai'),
    }), request.body)
    return reply.status(201).send(service.createStation(body))
  })

  app.post('/api/stations/join', async (request, reply) => {
    const body = parse(z.object({ code: z.string().trim().length(6).transform((value) => value.toUpperCase()), nickname: nicknameSchema }), request.body)
    return reply.status(201).send(service.joinStation(body))
  })

  app.get('/api/stations/lookup/:code', async (request) => {
    const params = parse(z.object({ code: z.string().trim().length(6).transform((value) => value.toUpperCase()) }), request.params)
    return service.lookupStation(params.code)
  })

  app.get('/api/session', async (request) => service.getSession(bearerToken(request)))

  app.patch('/api/stations/current', async (request) => {
    const body = parse(z.object({ name: stationNameSchema, departureTime: timeSchema }), request.body)
    return service.updateStation(bearerToken(request), body)
  })

  app.post('/api/summaries/generate', async (request) => {
    const body = parse(z.object({ sourceText: z.string().trim().min(1).max(10_000) }), request.body)
    return service.generateSummary(bearerToken(request), body.sourceText)
  })

  app.put('/api/summaries/today', async (request, reply) => {
    const body = parse(z.object({
      sourceText: z.string().trim().min(1).max(10_000),
      completed: z.string().trim().min(1).max(1_000),
      progress: z.string().trim().min(1).max(1_000),
      tomorrow: z.string().trim().min(1).max(1_000),
      provider: z.enum(['deepseek', 'local', 'local-fallback']),
      warning: z.string().max(1_000).optional(),
    }), request.body)
    return reply.status(201).send(service.saveSummary(bearerToken(request), body))
  })

  app.post('/api/tickets', async (request, reply) => {
    const body = parse(z.object({ summaryId: z.string().uuid().optional() }).default({}), request.body || {})
    return reply.status(201).send(service.issueTicket(bearerToken(request), body.summaryId))
  })

  app.post('/api/tickets/:ticketId/checkin', async (request) => {
    const params = parse(z.object({ ticketId: z.string().uuid() }), request.params)
    return service.checkIn(bearerToken(request), params.ticketId)
  })

  app.get('/api/lobby', async (request) => service.getLobby(bearerToken(request)))

  app.post('/api/lobby/draw', async (request) => {
    const body = parse(z.object({ preview: z.boolean().default(false) }).default({ preview: false }), request.body || {})
    return service.draw(bearerToken(request), body.preview)
  })

  app.get('/api/journey', async (request) => service.getJourney(bearerToken(request)))

  if (options.config.serveStatic) {
    const distPath = path.join(process.cwd(), 'dist')
    if (fs.existsSync(distPath)) {
      await app.register(fastifyStatic, { root: distPath })
      app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith('/api/')) return reply.status(404).send({ error: { code: 'not_found', message: '接口不存在。' } })
        return reply.sendFile('index.html')
      })
    }
  }

  return app
}
