import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import { env } from './config.js';
import { db } from './db/client.js';
import { HttpError } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import securityPlugin from './plugins/security.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import fileRoutes from './routes/files.js';
import meRoutes from './routes/me.js';
import playlistRoutes from './routes/playlists.js';
import streamRoutes from './routes/stream.js';
import { meili } from './services/search.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Les jetons de flux transitent en query string : on les masque dans les logs.
      serializers: {
        req: (req) => ({ method: req.method, url: req.url.replace(/(token|sig)=[^&]+/g, '$1=***') }),
      },
    },
    trustProxy: true,
    // L'API ne reçoit que de petits objets JSON : inutile d'accepter 1 Mo (valeur par défaut).
    bodyLimit: 64 * 1024,
  });

  await app.register(cors, {
    origin: env.WEB_ORIGIN.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
    // Par défaut, @fastify/cors n'autorise que GET, HEAD et POST : likes (PUT), suppressions (DELETE) et
    // modifications (PATCH) échouaient alors depuis une autre origine (site local, appli Windows).
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  });
  await app.register(cookie);
  await app.register(securityPlugin);
  await app.register(authPlugin);

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: error.issues[0]?.message ?? 'Requête invalide',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.code ?? 'ERROR', message: error.message });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: 'ERROR', message: (error as Error).message });
    }
    req.log.error(error);
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur interne du serveur' });
  });

  app.get('/health', async () => {
    const checks: Record<string, string> = {};
    await db.execute(sql`select 1`).then(
      () => (checks.database = 'ok'),
      () => (checks.database = 'down'),
    );
    checks.search = meili ? await meili.health().then((h) => h.status, () => 'down') : 'postgres-fallback';
    checks.storage = env.STORAGE_DRIVER;
    return { status: checks.database === 'ok' ? 'ok' : 'degraded', checks };
  });

  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(catalogRoutes);
  await app.register(playlistRoutes);
  await app.register(streamRoutes);
  await app.register(fileRoutes);

  return app;
}
