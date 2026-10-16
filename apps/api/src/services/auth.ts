import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { refreshTokens, type User } from '../db/schema.js';
import type { AccessTokenPayload } from '../plugins/auth.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Deux onglets peuvent rafraîchir la session au même moment avec le même cookie : un jeton tout juste
// remplacé n'est pas pour autant un signe de vol.
const REUSE_GRACE_MS = 60_000;

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
  // Ménage : les jetons expirés ou révoqués depuis plus d'un jour ne servent plus à rien.
  const dayAgo = new Date(Date.now() - 86_400_000);
  await db
    .delete(refreshTokens)
    .where(and(eq(refreshTokens.userId, user.id), or(lt(refreshTokens.expiresAt, new Date()), lt(refreshTokens.revokedAt, dayAgo))));

  return { accessToken, expiresIn: env.JWT_ACCESS_TTL, refreshToken, refreshExpiresAt: expiresAt };
}

/**
 * Consomme un jeton de rafraîchissement (rotation) et renvoie l'utilisateur associé.
 * Un jeton déjà remplacé qui resurgit signale un vol probable : toutes les sessions du compte sont alors fermées.
 */
export async function consumeRefreshToken(token: string) {
  const tokenHash = hashToken(token);
  const [row] = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())))
    .returning({ userId: refreshTokens.userId });
  if (row) return row.userId;

  const [reused] = await db
    .select({ userId: refreshTokens.userId, revokedAt: refreshTokens.revokedAt })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash));
  if (reused?.revokedAt && Date.now() - reused.revokedAt.getTime() > REUSE_GRACE_MS) await revokeAllSessions(reused.userId);
  return null;
}

export async function revokeRefreshToken(token: string) {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, hashToken(token)), isNull(refreshTokens.revokedAt)));
}

/** Ferme toutes les sessions d'un compte (déconnexion de tous les appareils, changement de mot de passe). */
export async function revokeAllSessions(userId: string) {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
