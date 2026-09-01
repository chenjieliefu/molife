import path from 'node:path'

export type AppConfig = {
  host: string
  port: number
  databasePath: string
  aiApiKey?: string
  aiModel: string
  aiBaseUrl: string
  serveStatic: boolean
}

export function loadConfig(): AppConfig {
  return {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 8787),
    databasePath: process.env.MOLIFE_DB_PATH || path.join(process.cwd(), 'data', 'molife.db'),
    aiApiKey: process.env.DEEPSEEK_API_KEY || undefined,
    aiModel: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    aiBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    serveStatic: process.env.NODE_ENV === 'production',
  }
}
