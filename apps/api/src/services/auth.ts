import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { refreshTokens, type User } from '../db/schema.js';
import type { AccessTokenPayload } from '../plugins/auth.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
  };
}

/** Émet un jeton d'accès court (JWT) et un jeton de rafraîchissement opaque, stocké haché en base. */
export async function issueTokens(app: FastifyInstance, user: User) {
  const payload: AccessTokenPayload = { sub: user.id, email: user.email, typ: 'access' };
  const accessToken = app.jwt.sign(payload, { expiresIn: env.JWT_ACCESS_TTL });

  const refreshToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await db.insert(refreshTokens).values({ userId: user.id, tokenHash: hashToken(refreshToken), expiresAt });

  return { accessToken, expiresIn: env.JWT_ACCESS_TTL, refreshToken, refreshExpiresAt: expiresAt };
}

/** Consomme un jeton de rafraîchissement (rotation) et renvoie l'utilisateur associé. */
export async function consumeRefreshToken(token: string) {
  const [row] = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokens.tokenHash, hashToken(token)),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: refreshTokens.userId });
  return row?.userId ?? null;
}

export async function revokeRefreshToken(token: string) {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, hashToken(token)), isNull(refreshTokens.revokedAt)));
}
