import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CreateStationInput, DrawRecord, MemberRecord, SessionRecord, StationRecord, SummaryRecord, TicketRecord } from './domain.js'

type DbRow = Record<string, string | number | null>

const INVITE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function makeInviteCode(): string {
  const bytes = randomBytes(6)
  return Array.from(bytes, (byte) => INVITE_CHARS[byte % INVITE_CHARS.length]).join('')
}

function makeToken(): string {
  return randomBytes(32).toString('base64url')
}

function stationFromRow(row: DbRow): StationRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    departureTime: String(row.departure_time),
    timezone: String(row.timezone),
    memberCount: Number(row.member_count || 0),
    createdAt: String(row.created_at),
  }
}

function memberFromRow(row: DbRow): MemberRecord {
  return {
    id: String(row.member_id ?? row.id),
    stationId: String(row.station_id),
    nickname: String(row.nickname),
    role: String(row.role) as MemberRecord['role'],
    accessToken: String(row.access_token),
    createdAt: String(row.member_created_at ?? row.created_at),
  }
}

function ticketFromRow(row: DbRow): TicketRecord {
  return {
    id: String(row.id),
    stationId: String(row.station_id),
    memberId: String(row.member_id),
    summaryId: row.summary_id ? String(row.summary_id) : null,
    workDate: String(row.work_date),
    departureTime: String(row.departure_time),
    stationName: String(row.station_name),
    seat: String(row.seat),
    checkedInAt: row.checked_in_at ? String(row.checked_in_at) : null,
    createdAt: String(row.created_at),
  }
}

export class MolifeStore {
  readonly database: DatabaseSync

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    this.database = new DatabaseSync(databasePath, { timeout: 5000 })
    this.database.exec('PRAGMA foreign_keys = ON;')
    if (databasePath !== ':memory:') this.database.exec('PRAGMA journal_mode = WAL;')
    this.migrate()
  }

  close(): void {
    this.database.close()
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS stations (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        departure_time TEXT NOT NULL,
        timezone TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
        nickname TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
        access_token TEXT NOT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS summaries (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
        member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        work_date TEXT NOT NULL,
        source_text TEXT NOT NULL,
        completed TEXT NOT NULL,
        progress TEXT NOT NULL,
        tomorrow TEXT NOT NULL,
        provider TEXT NOT NULL,
        warning TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(member_id, work_date)
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
        member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        summary_id TEXT REFERENCES summaries(id) ON DELETE SET NULL,
        work_date TEXT NOT NULL,
        departure_time TEXT NOT NULL,
        station_name TEXT NOT NULL,
        seat TEXT NOT NULL,
        checked_in_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(member_id, work_date)
      );

      CREATE TABLE IF NOT EXISTS draws (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
        work_date TEXT NOT NULL,
        leader_member_ids TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(station_id, work_date)
      );

      CREATE INDEX IF NOT EXISTS members_station_idx ON members(station_id, active);
      CREATE INDEX IF NOT EXISTS tickets_lobby_idx ON tickets(station_id, work_date, checked_in_at);
    `)
  }

  createStationWithOwner(input: CreateStationInput): SessionRecord {
    const now = new Date().toISOString()
    const stationId = randomUUID()
    const memberId = randomUUID()
    const accessToken = makeToken()
    let code = makeInviteCode()
    while (this.database.prepare('SELECT 1 FROM stations WHERE code = ?').get(code)) code = makeInviteCode()

    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        INSERT INTO stations (id, code, name, departure_time, timezone, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(stationId, code, input.name, input.departureTime, input.timezone, now)
      this.database.prepare(`
        INSERT INTO members (id, station_id, nickname, role, access_token, created_at)
        VALUES (?, ?, ?, 'owner', ?, ?)
      `).run(memberId, stationId, input.nickname, accessToken, now)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }

    return this.getSessionByToken(accessToken)!
  }

  joinStation(code: string, nickname: string): SessionRecord | null {
    const station = this.database.prepare('SELECT id FROM stations WHERE code = ?').get(code) as DbRow | undefined
    if (!station) return null
    const now = new Date().toISOString()
    const memberId = randomUUID()
    const accessToken = makeToken()
    this.database.prepare(`
      INSERT INTO members (id, station_id, nickname, role, access_token, created_at)
      VALUES (?, ?, ?, 'member', ?, ?)
    `).run(memberId, String(station.id), nickname, accessToken, now)
    return this.getSessionByToken(accessToken)
  }

  getStationByCode(code: string): StationRecord | null {
    const row = this.database.prepare(`
      SELECT s.*, (SELECT COUNT(*) FROM members m WHERE m.station_id = s.id AND m.active = 1) AS member_count
      FROM stations s
      WHERE s.code = ?
    `).get(code) as DbRow | undefined
    return row ? stationFromRow(row) : null
  }

  getSessionByToken(token: string): SessionRecord | null {
    const row = this.database.prepare(`
      SELECT
        s.id, s.code, s.name, s.departure_time, s.timezone, s.created_at,
        (SELECT COUNT(*) FROM members count_member WHERE count_member.station_id = s.id AND count_member.active = 1) AS member_count,
        m.id AS member_id, m.station_id, m.nickname, m.role, m.access_token, m.created_at AS member_created_at
      FROM members m
      JOIN stations s ON s.id = m.station_id
      WHERE m.access_token = ? AND m.active = 1
    `).get(token) as DbRow | undefined
    if (!row) return null
    return { station: stationFromRow(row), member: memberFromRow(row) }
  }

  updateStation(stationId: string, name: string, departureTime: string): StationRecord {
    this.database.prepare('UPDATE stations SET name = ?, departure_time = ? WHERE id = ?').run(name, departureTime, stationId)
    const row = this.database.prepare(`
      SELECT s.*, (SELECT COUNT(*) FROM members m WHERE m.station_id = s.id AND m.active = 1) AS member_count
      FROM stations s WHERE s.id = ?
    `).get(stationId) as DbRow
    return stationFromRow(row)
  }

  upsertSummary(input: Omit<SummaryRecord, 'id' | 'createdAt' | 'updatedAt'>): SummaryRecord {
    const now = new Date().toISOString()
    const id = randomUUID()
    this.database.prepare(`
      INSERT INTO summaries (
        id, station_id, member_id, work_date, source_text, completed, progress, tomorrow, provider, warning, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(member_id, work_date) DO UPDATE SET
        source_text = excluded.source_text,
        completed = excluded.completed,
        progress = excluded.progress,
        tomorrow = excluded.tomorrow,
        provider = excluded.provider,
        warning = excluded.warning,
        updated_at = excluded.updated_at
    `).run(
      id, input.stationId, input.memberId, input.workDate, input.sourceText,
      input.completed, input.progress, input.tomorrow, input.provider, input.warning ?? null, now, now,
    )
    const row = this.database.prepare('SELECT * FROM summaries WHERE member_id = ? AND work_date = ?').get(input.memberId, input.workDate) as DbRow
    return {
      id: String(row.id),
      stationId: String(row.station_id),
      memberId: String(row.member_id),
      workDate: String(row.work_date),
      sourceText: String(row.source_text),
      completed: String(row.completed),
      progress: String(row.progress),
      tomorrow: String(row.tomorrow),
      provider: String(row.provider) as SummaryRecord['provider'],
      warning: row.warning ? String(row.warning) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  hasMemberSummary(summaryId: string, memberId: string): boolean {
    return Boolean(this.database.prepare('SELECT 1 FROM summaries WHERE id = ? AND member_id = ?').get(summaryId, memberId))
  }

  issueTicket(session: SessionRecord, workDate: string, summaryId: string | null): TicketRecord {
    const existing = this.findMemberTicket(session.member.id, workDate)
    if (existing) return existing
    const issuedCount = Number((this.database.prepare('SELECT COUNT(*) AS count FROM tickets WHERE station_id = ? AND work_date = ?').get(session.station.id, workDate) as DbRow).count)
    const id = randomUUID()
    const now = new Date().toISOString()
    const seat = `LIFE ${String(issuedCount + 1).padStart(2, '0')}`
    this.database.prepare(`
      INSERT INTO tickets (id, station_id, member_id, summary_id, work_date, departure_time, station_name, seat, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, session.station.id, session.member.id, summaryId, workDate, session.station.departureTime, session.station.name, seat, now)
    return this.findMemberTicket(session.member.id, workDate)!
  }

  findMemberTicket(memberId: string, workDate: string): TicketRecord | null {
    const row = this.database.prepare('SELECT * FROM tickets WHERE member_id = ? AND work_date = ?').get(memberId, workDate) as DbRow | undefined
    return row ? ticketFromRow(row) : null
  }

  checkInTicket(ticketId: string, memberId: string): TicketRecord | null {
    const now = new Date().toISOString()
    this.database.prepare(`
      UPDATE tickets SET checked_in_at = COALESCE(checked_in_at, ?)
      WHERE id = ? AND member_id = ?
    `).run(now, ticketId, memberId)
    const row = this.database.prepare('SELECT * FROM tickets WHERE id = ? AND member_id = ?').get(ticketId, memberId) as DbRow | undefined
    return row ? ticketFromRow(row) : null
  }

  listLobbyMembers(stationId: string, workDate: string): Array<MemberRecord & { checkedIn: boolean }> {
    const rows = this.database.prepare(`
      SELECT m.*, m.id AS member_id,
        CASE WHEN t.checked_in_at IS NULL THEN 0 ELSE 1 END AS checked_in
      FROM members m
      LEFT JOIN tickets t ON t.member_id = m.id AND t.work_date = ?
      WHERE m.station_id = ? AND m.active = 1
      ORDER BY m.created_at ASC
    `).all(workDate, stationId) as DbRow[]
    return rows.map((row) => ({ ...memberFromRow(row), checkedIn: Boolean(row.checked_in) }))
  }

  getDraw(stationId: string, workDate: string): DrawRecord | null {
    const row = this.database.prepare('SELECT * FROM draws WHERE station_id = ? AND work_date = ?').get(stationId, workDate) as DbRow | undefined
    if (!row) return null
    return {
      id: String(row.id),
      stationId: String(row.station_id),
      workDate: String(row.work_date),
      leaderMemberIds: JSON.parse(String(row.leader_member_ids)) as string[],
      createdAt: String(row.created_at),
    }
  }

  saveDraw(stationId: string, workDate: string, leaderMemberIds: string[]): DrawRecord {
    const now = new Date().toISOString()
    this.database.prepare(`
      INSERT INTO draws (id, station_id, work_date, leader_member_ids, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(station_id, work_date) DO NOTHING
    `).run(randomUUID(), stationId, workDate, JSON.stringify(leaderMemberIds), now)
    return this.getDraw(stationId, workDate)!
  }

  listTickets(memberId: string): TicketRecord[] {
    const rows = this.database.prepare('SELECT * FROM tickets WHERE member_id = ? ORDER BY work_date DESC LIMIT 30').all(memberId) as DbRow[]
    return rows.map(ticketFromRow)
  }
}
