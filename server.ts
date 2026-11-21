import 'dotenv/config';
import { sql } from 'drizzle-orm';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createRateLimiter, getJwtSecret } from './server/auth.ts';
import { closeDb, getDb, getDbMode, seedGuildDefaults } from './server/db.ts';
import { getBotRuntimeState, startDiscordBotIfConfigured } from './server/discordBot.ts';
import { createApiRouter } from './server/routes.ts';
import { guilds } from './server/schema.ts';
import { startSingleInstanceScheduler, stopScheduler } from './server/scheduler.ts';
import { utcNowIso } from './server/time.ts';

async function startServer() {
  // Validate JWT secret early in production
  getJwtSecret();

  const db = await getDb();

  // Auto-ensure guild defaults if DISCORD_GUILD_ID is configured in environment (rates & role aliases only — zero fake data)
  const envGuildId = process.env.DISCORD_GUILD_ID?.trim();
  const existingGuilds = await db.select().from(guilds);
  if (existingGuilds.length === 0 && envGuildId && /^\d+$/.test(envGuildId)) {
    const [created] = await db
      .insert(guilds)
      .values({
        discordGuildId: envGuildId,
        name: process.env.GUILD_NAME?.trim() || 'ComicPay Discord Server',
        timezone: 'Asia/Jakarta',
        isActive: true,
      })
      .returning();
    await seedGuildDefaults(db, created.id);
  } else {
    for (const g of existingGuilds) {
      await seedGuildDefaults(db, g.id);
    }
  }

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  // Restricted CORS for dashboard origin & localhost development
  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  );
  if (process.env.APP_URL && !process.env.APP_URL.includes('MY_APP_URL')) {
    allowedOrigins.add(process.env.APP_URL.trim());
  }

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || allowedOrigins.has(origin) || origin.includes('run.app') || origin.includes('localhost')) {
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  const rateWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
  const rateMax = Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 300;
  app.use('/api', createRateLimiter(rateWindowMs, rateMax));

  // Public health endpoint required by VPS / Docker / Nginx monitoring
  app.get('/health', async (_req, res) => {
    try {
      await db.execute(sql`SELECT 1`);
      res.json({
        status: 'ok',
        database: 'connected',
        databaseMode: getDbMode(),
        bot: getBotRuntimeState(),
        timestamp: utcNowIso(),
      });
    } catch (err) {
      res.status(503).json({ status: 'error', error: err instanceof Error ? err.message : 'DB error' });
    }
  });

  app.use('/api', createApiRouter(db));

  // Start single-instance Asia/Jakarta payroll scheduler & integrated discord.js Gateway bot
  startSingleInstanceScheduler(db);
  void startDiscordBotIfConfigured(db);

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');

  if (!isProd || !fs.existsSync(distDir)) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  const httpServer = app.listen(port, '0.0.0.0', () => {
    console.log(`[ComicPay] Unified server running on http://0.0.0.0:${port} (db: ${getDbMode()})`);
  });

  const shutdown = async () => {
    console.log('[ComicPay] Shutting down gracefully...');
    stopScheduler();
    httpServer.close();
    await closeDb();
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

startServer().catch((err) => {
  console.error('[ComicPay] Fatal startup error:', err);
  process.exit(1);
});
