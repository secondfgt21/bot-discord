import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AppDb } from './db.ts';
import { adminUsers } from './schema.ts';
import type { AdminRole, AuthUser } from './types.ts';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const EPHEMERAL_DEV_SECRET = crypto.randomBytes(32).toString('hex');

export function getJwtSecret(): string {
  const envSecret = process.env.JWT_SECRET;
  if (envSecret && !envSecret.includes('REPLACE_WITH') && envSecret.length >= 32) {
    return envSecret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[ComicPay] FATAL: JWT_SECRET wajib diisi minimal 32 karakter pada mode production.'
    );
  }
  return EPHEMERAL_DEV_SECRET;
}

export function signAuthToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      discordUserId: user.discordUserId ?? null,
    },
    getJwtSecret(),
    { expiresIn: '12h' }
  );
}

export async function verifyJwtToken(
  db: AppDb,
  token: string
): Promise<AuthUser | null> {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { sub: string };
    const rows = await db
      .select({
        id: adminUsers.id,
        email: adminUsers.email,
        fullName: adminUsers.fullName,
        role: adminUsers.role,
        discordUserId: adminUsers.discordUserId,
        isActive: adminUsers.isActive,
      })
      .from(adminUsers)
      .where(eq(adminUsers.id, decoded.sub))
      .limit(1);

    if (rows.length === 0 || !rows[0].isActive) return null;
    const row = rows[0];
    return {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      role: row.role as AdminRole,
      discordUserId: row.discordUserId,
    };
  } catch {
    const supabaseSecret = process.env.SUPABASE_JWT_SECRET;
    if (supabaseSecret && !supabaseSecret.includes('YOUR_')) {
      try {
        const supaDecoded = jwt.verify(token, supabaseSecret) as { email?: string };
        if (!supaDecoded.email) return null;
        const rows = await db
          .select({
            id: adminUsers.id,
            email: adminUsers.email,
            fullName: adminUsers.fullName,
            role: adminUsers.role,
            discordUserId: adminUsers.discordUserId,
            isActive: adminUsers.isActive,
          })
          .from(adminUsers)
          .where(eq(adminUsers.email, supaDecoded.email.toLowerCase()))
          .limit(1);

        if (rows.length === 0 || !rows[0].isActive) return null;
        const row = rows[0];
        return {
          id: row.id,
          email: row.email,
          fullName: row.fullName,
          role: row.role as AdminRole,
          discordUserId: row.discordUserId,
        };
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function createAuthMiddleware(db: AppDb) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
    const rawToken =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : queryToken;

    if (!rawToken) {
      res.status(401).json({ error: 'Autentikasi diperlukan. Silakan login terlebih dahulu.' });
      return;
    }

    try {
      const user = await verifyJwtToken(db, rawToken);
      if (!user) {
        res.status(401).json({ error: 'Token sesi tidak valid atau akun dinonaktifkan.' });
        return;
      }
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Gagal memverifikasi token sesi.' });
    }
  };
}

export function requireRoles(allowedRoles: AdminRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Autentikasi diperlukan.' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Akses ditolak. Peran "${req.user.role}" tidak memiliki izin untuk tindakan ini.`,
      });
      return;
    }
    next();
  };
}

export function createRateLimiter(windowMs = 60_000, maxRequests = 240) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > maxRequests) {
      res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar lagi.' });
      return;
    }
    next();
  };
}
