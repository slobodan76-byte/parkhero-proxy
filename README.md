# ParkHero Proxy (Production-Ready)

Deploy-ready proxy server for ParkHero.

## Features
- Node/Express backend with Helmet, CORS, logging
- Redis or in-memory caching
- Retries with backoff
- Healthcheck endpoint
- Demo data if no UPSTREAM_URL is configured
- Dockerfile for deployment
- Render and Railway configs included

## Quick Start (local)
```bash
npm install
cp .env.example .env
npm start
# http://localhost:8080/health
# http://localhost:8080/api/garages
```

## Deploy
- **Render**: use render.yaml
- **Railway**: use railway.json
- **Heroku**: uses Procfile

## Env vars
- UPSTREAM_URL: real parking data feed (leave blank for demo data)
- UPSTREAM_AUTH: optional auth header
- CACHE_TTL: cache time in seconds
- RETRIES: retry attempts for upstream fetch
- REDIS_URL: optional Redis connection string
- CORS_ORIGIN: allowed origins (use * in dev)
- PORT: port to bind (8080 default)
