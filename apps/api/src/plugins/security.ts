import { createHmac, timingSafeEqual } from 'node:crypto';
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import { env } from '../config.js';
import { HttpError } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Adresse IP du visiteur, fiable pour les limites de débit (voir clientIp). */
    clientIp: string;
  }
}

/**
 * IP du visiteur. X-Forwarded-For peut commencer par ce que le client a bien voulu envoyer : l'en-tête posé par
 * l'hébergeur lui-même fait foi (Vercel, ou l'ancien relais Netlify). À défaut (développement local), l'IP de connexion.
 */
function clientIp(req: FastifyRequest) {
  const fromHost = process.env.VERCEL ? req.headers['x-vercel-forwarded-for'] : req.headers['x-nf-client-connection-ip'];
  return (typeof fromHost === 'string' && fromHost.split(',')[0]!.trim()) || req.ip;
}

/** Vérifie l'en-tête x-nf-sign (JWS HS256) ajouté par Netlify aux requêtes relayées par une redirection « signed ». */
function hasValidProxySignature(header: unknown, secret: string) {
  if (typeof header !== 'string') return false;
  const [head, body, signature] = header.split('.');
  if (!head || !body || !signature) return false;
  try {
    if (JSON.parse(Buffer.from(head, 'base64url').toString()).alg !== 'HS256') return false;
    const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest();
    const given = Buffer.from(signature, 'base64url');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    return claims.iss === 'netlify' && (typeof claims.exp !== 'number' || claims.exp * 1000 > Date.now());
  } catch {
    return false;
  }
}

// Réponses à ne jamais garder en cache (navigateur, proxy) : elles contiennent des jetons ou des données personnelles.
const PRIVATE_ROUTES = /^\/(auth|me|playlists|tracks\/[^/]+\/play)(\/|$|\?)/;

export default fp(async (app) => {
  app.decorateRequest('clientIp', '');

  app.addHook('onRequest', async (req) => {
    req.clientIp = clientIp(req);
    // /health reste joignable en direct : Render l'interroge pour surveiller le service.
    if (env.PROXY_SIGNATURE_SECRET && req.url !== '/health' && !hasValidProxySignature(req.headers['x-nf-sign'], env.PROXY_SIGNATURE_SECRET)) {
      throw new HttpError(403, 'Accès direct refusé : passez par le site Velora', 'FORBIDDEN');
    }
  });

  // Limite globale par visiteur (les routes sensibles ont en plus leur propre limite, plus stricte) :
  // freine le moissonnage du catalogue et l'épuisement des quotas YouTube/Jamendo.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.clientIp,
    allowList: (req) => req.url === '/health',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: `Trop de requêtes, réessayez dans ${Math.ceil(ctx.ttl / 1000)} s`,
    }),
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cross-origin-opener-policy', 'same-origin');
    if (PRIVATE_ROUTES.test(req.url) && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });
});
