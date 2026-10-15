import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validation.js';
import { consumeRefreshToken, issueTokens, publicUser, revokeRefreshToken } from '../services/auth.js';

const REFRESH_COOKIE = 'velora_rt';
const DUMMY_HASH = bcrypt.hashSync('velora-timing-equalizer', 12);

const RegisterBody = z.object({
  email: z.string().trim().email('Email invalide').max(254),
  password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères').max(128),
  displayName: z.string().trim().min(1).max(60),
});
const LoginBody = z.object({ email: z.string().trim().email(), password: z.string().min(1) });
const RefreshBody = z.object({ refreshToken: z.string().optional() }).optional();

/**
 * Le jeton de rafraîchissement est posé en cookie httpOnly pour le web.
 * Les clients natifs (header `x-velora-client: native`) le reçoivent aussi dans le corps de la réponse.
 */
function sendSession(req: FastifyRequest, reply: FastifyReply, tokens: Awaited<ReturnType<typeof issueTokens>>, user: typeof users.$inferSelect) {
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
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

  app.post('/auth/register', { config: rateLimit }, async (req, reply) => {
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
    const [user] = await db.select().from(users).where(eq(sql`lower(${users.email})`, body.email.toLowerCase()));
    // Comparaison effectuée même si l'utilisateur n'existe pas, pour limiter l'énumération par timing.
    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw unauthorized('Email ou mot de passe incorrect');
    return sendSession(req, reply, await issueTokens(app, user), user);
  });

  app.post('/auth/refresh', { config: rateLimit }, async (req, reply) => {
    const token = parse(RefreshBody, req.body)?.refreshToken ?? req.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized('Jeton de rafraîchissement manquant');
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
}
