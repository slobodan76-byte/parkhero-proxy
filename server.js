import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import fetch from 'node-fetch'
import pino from 'pino'
import pinoHttp from 'pino-http'
import Redis from 'ioredis'
import crypto from 'crypto'

const log = pino({ level: process.env.LOG_LEVEL || 'info' })
const app = express()
app.disable('x-powered-by')
app.use(helmet())
const origins = (process.env.CORS_ORIGIN || '*').split(',').map(s=>s.trim())
app.use(cors({ origin: origins.includes('*') ? true : origins }))
app.use(express.json({ limit: '200kb' }))
app.use(pinoHttp({ logger: log }))

const UPSTREAM_URL = process.env.UPSTREAM_URL
const UPSTREAM_AUTH = process.env.UPSTREAM_AUTH || ''
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '60', 10)
const RETRIES = parseInt(process.env.RETRIES || '3', 10)
const PORT = parseInt(process.env.PORT || '8080', 10)

let redis = null
const REDIS_URL = process.env.REDIS_URL
if (REDIS_URL) {
  redis = new Redis(REDIS_URL)
  redis.on('error', (e) => log.error({ err: e }, 'Redis error'))
}

const memoryCache = new Map()

async function setCache(key, payload, ttlSeconds) {
  const value = JSON.stringify(payload)
  if (redis) {
    await redis.setex(key, ttlSeconds, value)
  } else {
    const expires = Date.now() + ttlSeconds * 1000
    memoryCache.set(key, { value, expires })
  }
}

async function getCache(key) {
  if (redis) {
    const v = await redis.get(key)
    return v ? JSON.parse(v) : null
  } else {
    const item = memoryCache.get(key)
    if (!item) return null
    if (Date.now() > item.expires) {
      memoryCache.delete(key)
      return null
    }
    return JSON.parse(item.value)
  }
}

function hash(body) {
  return crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex')
}

async function fetchUpstreamWithRetry(url, options = {}) {
  let attempt = 0
  let lastErr = null
  while (attempt < RETRIES) {
    try {
      const res = await fetch(url, options)
      if (!res.ok) throw new Error(`Upstream ${res.status}`)
      const data = await res.json()
      return data
    } catch (e) {
      lastErr = e
      attempt++
      await new Promise(r => setTimeout(r, 300 * attempt))
    }
  }
  throw lastErr
}

app.get('/health', async (req, res) => {
  res.json({ ok: true, uptime: process.uptime() })
})

app.get('/api/garages', async (req, res) => {
  const cacheKey = 'garages:v1'
  try {
    const cached = await getCache(cacheKey)
    if (cached) {
      res.set('X-Cache', 'HIT')
      res.set('ETag', cached.etag)
      if (req.headers['if-none-match'] === cached.etag) {
        return res.status(304).end()
      }
      return res.json(cached.body)
    }

    if (!UPSTREAM_URL) {
      const demo = {
        updatedAt: new Date().toISOString(),
        garages: [
          { id: 'obilicev-venac', name: 'Obilićev venac', lat: 44.81725, lng: 20.45593, capacity: 804, free: 42, address: 'Obilićev venac 14-16', type: 'garage' },
          { id: 'masarikova', name: 'Masarikova', lat: 44.80771, lng: 20.46202, capacity: 457, free: 18, address: 'Masarikova 4', type: 'garage' },
          { id: 'zeleni-venac', name: 'Zeleni venac', lat: 44.81484, lng: 20.45527, capacity: 320, free: 5, address: 'Brankova 4', type: 'garage' },
          { id: 'pinki', name: 'Pinki (Novi Beograd)', lat: 44.82120, lng: 20.39720, capacity: 150, free: 27, address: 'Bul. Zorana Đinđića 12', type: 'garage' }
        ]
      }
      const et = hash(demo)
      await setCache(cacheKey, { etag: et, body: demo }, CACHE_TTL)
      res.set('X-Cache', 'MISS')
      res.set('ETag', et)
      return res.json(demo)
    }

    const headers = {}
    if (UPSTREAM_AUTH) headers['Authorization'] = UPSTREAM_AUTH
    const raw = await fetchUpstreamWithRetry(UPSTREAM_URL, { headers })
    const payload = raw.updatedAt && raw.garages ? raw : {
      updatedAt: new Date().toISOString(),
      garages: Array.isArray(raw) ? raw : []
    }
    const etag = hash(payload)
    await setCache(cacheKey, { etag, body: payload }, CACHE_TTL)
    res.set('X-Cache', 'MISS')
    res.set('ETag', etag)
    res.json(payload)
  } catch (e) {
    req.log.error({ err: e }, 'garages failed')
    res.status(502).json({ error: 'Upstream error', detail: String(e) })
  }
})

app.listen(PORT, () => log.info({ port: PORT }, 'ParkHero proxy up'))
