import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config.js';
import { unauthorized } from '../lib/errors.js';

export type AccessTokenPayload = { sub: string; email: string; typ: 'access' };
export type StreamTokenPayload = { sub: string; tid: string; typ: 'stream' };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenPayload | StreamTokenPayload;
    user: AccessTokenPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (app) => {
  await app.register(jwt, { secret: env.JWT_SECRET });

  async function readAccessToken(req: FastifyRequest) {
    const payload = await req.jwtVerify<AccessTokenPayload>();
    if (payload.typ !== 'access') throw unauthorized('Jeton invalide');
    req.user = payload;
  }

  app.decorate('authenticate', async (req: FastifyRequest) => {
    try {
      await readAccessToken(req);
    } catch {
      throw unauthorized('Jeton manquant, invalide ou expiré');
    }
  });

  // Renseigne req.user si un jeton valide est fourni, sans l'exiger.
  app.decorate('optionalAuth', async (req: FastifyRequest) => {
    if (!req.headers.authorization) return;
    await readAccessToken(req).catch(() => undefined);
  });
});
