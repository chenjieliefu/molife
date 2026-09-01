import dotenv from 'dotenv'
import fs from 'node:fs'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'

// Load the conventional hidden file first, then override only with non-empty values
// from the visible project-specific config. This keeps both setup paths working.
dotenv.config({ path: '.env' })
if (fs.existsSync('molife.env')) {
  const visibleConfig = dotenv.parse(fs.readFileSync('molife.env'))
  for (const [key, value] of Object.entries(visibleConfig)) {
    if (value.trim()) process.env[key] = value
  }
}

const config = loadConfig()
const app = await buildApp({ config })

const shutdown = async () => {
  await app.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
