import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';
import mime from 'mime-types';
import { z } from 'zod';
import { env } from '../config.js';
import { forbidden, notFound } from '../lib/errors.js';
import { localStorage, PUBLIC_PREFIX, storage, verifyLocalSignature } from '../lib/storage.js';
import { parse } from '../lib/validation.js';

const SignedQuery = z.object({ exp: z.coerce.number(), sig: z.string() });

async function sendLocalFile(reply: FastifyReply, key: string, cacheControl: string) {
  let full: string;
  try {
    full = localStorage.resolve(key);
    if (!(await stat(full)).isFile()) throw new Error();
  } catch {
    throw notFound('Fichier');
  }
  const type = key.endsWith('.ts') ? 'video/mp2t' : mime.lookup(key) || 'application/octet-stream';
  return reply.header('content-type', type).header('cache-control', cacheControl).send(createReadStream(full));
}

export default async function fileRoutes(app: FastifyInstance) {
  // Images publiques (pochettes). Stockage local : servies directement ; S3 : redirection vers une URL signée.
  app.get('/assets/*', async (req, reply) => {
    const key = (req.params as { '*': string })['*'];
    if (!key.startsWith(PUBLIC_PREFIX) || key.includes('..')) throw forbidden();
    if (env.STORAGE_DRIVER === 'local') return sendLocalFile(reply, key, 'public, max-age=86400');
    const url = await storage.signedUrl(key, 86_400);
    return reply.header('cache-control', 'public, max-age=3600').redirect(url);
  });

  // Fichiers du stockage local protégés par signature HMAC (équivalent des URL pré-signées S3).
  if (env.STORAGE_DRIVER === 'local') {
    app.get('/files/*', async (req, reply) => {
      const key = (req.params as { '*': string })['*'];
      const { exp, sig } = parse(SignedQuery, req.query);
      if (!verifyLocalSignature(key, exp, sig)) throw forbidden('Signature invalide ou expirée');
      return sendLocalFile(reply, key, 'private, max-age=3600');
    });
  }
}
