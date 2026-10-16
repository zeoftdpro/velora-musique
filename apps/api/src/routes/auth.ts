import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { conflict, HttpError, unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validation.js';
import { consumeRefreshToken, issueTokens, publicUser, revokeAllSessions, revokeRefreshToken } from '../services/auth.js';

const REFRESH_COOKIE = 'velora_rt';
const DUMMY_HASH = bcrypt.hashSync('velora-timing-equalizer', 12);

// bcrypt ignore tout ce qui dépasse 72 octets : un mot de passe plus long serait tronqué sans le dire.
const Password = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
  .refine((p) => Buffer.byteLength(p) <= 72, 'Le mot de passe est trop long (72 octets maximum)');

const RegisterBody = z.object({
  email: z.string().trim().email('Email invalide').max(254),
  password: Password,
  displayName: z.string().trim().min(1).max(60),
});
const LoginBody = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) });
const RefreshBody = z.object({ refreshToken: z.string().max(200).optional() }).optional();
const ChangePasswordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: Password });

/**
 * Verrou par compte, en plus de la limite par IP : un attaquant qui change d'adresse à chaque essai ne peut
 * pas pour autant tester des milliers de mots de passe sur le même email.
 */
const MAX_FAILURES = 8;
const LOCK_MS = 15 * 60_000;
const failures = new Map<string, { count: number; since: number }>();

function assertNotLocked(email: string) {
  const entry = failures.get(email);
  if (!entry) return;
  const remaining = entry.since + LOCK_MS - Date.now();
  if (remaining <= 0) failures.delete(email);
  else if (entry.count >= MAX_FAILURES) {
    throw new HttpError(429, `Trop de tentatives sur ce compte, réessayez dans ${Math.ceil(remaining / 60_000)} min`, 'RATE_LIMITED');
  }
}

function recordFailure(email: string) {
  if (failures.size > 10_000) failures.clear(); // garde-fou mémoire
  const entry = failures.get(email);
  if (entry && entry.since + LOCK_MS > Date.now()) entry.count += 1;
  else failures.set(email, { count: 1, since: Date.now() });
}

/**
 * Le jeton de rafraîchissement est posé en cookie httpOnly pour le web.
 * Les clients natifs (header `x-velora-client: native`) le reçoivent aussi dans le corps de la réponse.
 */
function sendSession(req: FastifyRequest, reply: FastifyReply, tokens: Awaited<ReturnType<typeof issueTokens>>, user: typeof users.$inferSelect) {
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    // Le site et l'API partagent la même origine (relais /api) : le cookie n'a jamais à partir d'un autre site.
    sameSite: 'strict',
    secure: env.PUBLIC_API_URL.startsWith('https'),
    // « / » plutôt que « /auth » : derrière le proxy Netlify, les routes sont vues sous /api/auth/….
    path: '/',
    expires: tokens.refreshExpiresAt,
  });
  const native = req.headers['x-velora-client'] === 'native';
  return {
    user: publicUser(user),
    accessToken: tokens.accessToken,
    expiresIn: tokens.expiresIn,
    ...(native ? { refreshToken: tokens.refreshToken } : {}),
  };
}

function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE, { path: '/' });
  reply.clearCookie(REFRESH_COOKIE, { path: '/auth' }); // ancien emplacement du cookie
}

export default async function authRoutes(app: FastifyInstance) {
  const rateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.post('/auth/register', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const body = parse(RegisterBody, req.body);
    const passwordHash = await bcrypt.hash(body.password, 12);
    const [user] = await db
      .insert(users)
      .values({ email: body.email.toLowerCase(), passwordHash, displayName: body.displayName })
      .onConflictDoNothing()
      .returning();
    if (!user) throw conflict('Un compte existe déjà avec cet email');
    reply.code(201);
    return sendSession(req, reply, await issueTokens(app, user), user);
  });

  app.post('/auth/login', { config: rateLimit }, async (req, reply) => {
    const body = parse(LoginBody, req.body);
    const email = body.email.toLowerCase();
    assertNotLocked(email);
    const [user] = await db.select().from(users).where(eq(sql`lower(${users.email})`, email));
    // Comparaison effectuée même si l'utilisateur n'existe pas, pour limiter l'énumération par timing.
    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      recordFailure(email);
      throw unauthorized('Email ou mot de passe incorrect');
    }
    failures.delete(email);
    return sendSession(req, reply, await issueTokens(app, user), user);
  });

  app.post('/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = parse(RefreshBody, req.body)?.refreshToken ?? req.cookies[REFRESH_COOKIE];
    // Visiteur non connecté : rien à rafraîchir, ce n'est pas une erreur.
    if (!token) return reply.code(204).send();
    const userId = await consumeRefreshToken(token);
    if (!userId) {
      clearRefreshCookie(reply);
      throw unauthorized('Session expirée, reconnectez-vous');
    }
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw unauthorized();
    return sendSession(req, reply, await issueTokens(app, user), user);
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = parse(RefreshBody, req.body)?.refreshToken ?? req.cookies[REFRESH_COOKIE];
    if (token) await revokeRefreshToken(token);
    clearRefreshCookie(reply);
    reply.code(204);
  });

  // Déconnecte tous les appareils (ordinateur oublié, appli Windows prêtée…).
  app.post('/auth/logout-all', { preHandler: app.authenticate }, async (req, reply) => {
    await revokeAllSessions(req.user.sub);
    clearRefreshCookie(reply);
    reply.code(204);
  });

  // Changement de mot de passe : ferme toutes les autres sessions et en ouvre une nouvelle pour cet appareil.
  app.post('/auth/password', { preHandler: app.authenticate, config: rateLimit }, async (req, reply) => {
    const body = parse(ChangePasswordBody, req.body);
    const [user] = await db.select().from(users).where(eq(users.id, req.user.sub));
    if (!user) throw unauthorized();
    assertNotLocked(user.email.toLowerCase());
    if (!user.passwordHash || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      recordFailure(user.email.toLowerCase());
      throw new HttpError(400, 'Mot de passe actuel incorrect', 'INVALID_PASSWORD');
    }
    const passwordHash = await bcrypt.hash(body.newPassword, 12);
    const [updated] = await db.update(users).set({ passwordHash }).where(eq(users.id, user.id)).returning();
    await revokeAllSessions(user.id);
    return sendSession(req, reply, await issueTokens(app, updated!), updated!);
  });
}
