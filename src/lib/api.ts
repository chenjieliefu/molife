import type {
  ApiError,
  GeneratedSummaryDto,
  JourneyDto,
  LobbyDto,
  SessionDto,
  StationDto,
  TicketDto,
  WorkSummaryDto,
} from '../shared/contracts'

export class MolifeApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message)
  }
}

export class MolifeClient {
  constructor(private token = '') {}

  setToken(token: string): void {
    this.token = token
  }

  async createStation(input: { name: string; departureTime: string; nickname: string; timezone?: string }): Promise<SessionDto> {
    return this.request('/api/stations', { method: 'POST', body: JSON.stringify(input) }, false)
  }

  async lookupStation(code: string): Promise<StationDto> {
    return this.request(`/api/stations/lookup/${encodeURIComponent(code)}`, {}, false)
  }

  async joinStation(input: { code: string; nickname: string }): Promise<SessionDto> {
    return this.request('/api/stations/join', { method: 'POST', body: JSON.stringify(input) }, false)
  }

  async getSession(): Promise<SessionDto> {
    return this.request('/api/session')
  }

  async updateStation(input: { name: string; departureTime: string }): Promise<StationDto> {
    return this.request('/api/stations/current', { method: 'PATCH', body: JSON.stringify(input) })
  }

  async generateSummary(sourceText: string): Promise<GeneratedSummaryDto> {
    return this.request('/api/summaries/generate', { method: 'POST', body: JSON.stringify({ sourceText }) })
  }

  async saveSummary(input: { sourceText: string; completed: string; progress: string; tomorrow: string; provider: WorkSummaryDto['provider']; warning?: string }): Promise<WorkSummaryDto> {
    return this.request('/api/summaries/today', { method: 'PUT', body: JSON.stringify(input) })
  }

  async issueTicket(summaryId?: string): Promise<TicketDto> {
    return this.request('/api/tickets', { method: 'POST', body: JSON.stringify(summaryId ? { summaryId } : {}) })
  }

  async checkIn(ticketId: string): Promise<TicketDto> {
    return this.request(`/api/tickets/${ticketId}/checkin`, { method: 'POST' })
  }

  async getLobby(): Promise<LobbyDto> {
    return this.request('/api/lobby')
  }

  async previewDraw(): Promise<LobbyDto> {
    return this.request('/api/lobby/draw', { method: 'POST', body: JSON.stringify({ preview: true }) })
  }

  async getJourney(): Promise<JourneyDto> {
    return this.request('/api/journey')
  }

  private async request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
    const headers = new Headers(init.headers)
    if (init.body) headers.set('content-type', 'application/json')
    if (authenticated && this.token) headers.set('authorization', `Bearer ${this.token}`)
    const response = await fetch(path, { ...init, headers })
    if (!response.ok) {
      let payload: ApiError | null = null
      try {
        payload = await response.json() as ApiError
      } catch {
        // The friendly network fallback below is more useful than a parsing error.
      }
      throw new MolifeApiError(payload?.error.code || 'network_error', payload?.error.message || '服务暂时没有回应，请稍后再试。', response.status)
    }
    return response.json() as Promise<T>
  }
}

