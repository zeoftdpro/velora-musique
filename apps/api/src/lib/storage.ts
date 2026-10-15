import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl as getS3SignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSignedUrl as getCloudFrontSignedUrl } from '@aws-sdk/cloudfront-signer';
import { readFileSync } from 'node:fs';
import { env, paths } from '../config.js';

/**
 * Abstraction du stockage objet.
 * - driver "s3"    : AWS S3, Cloudflare R2 ou MinIO ; URL pré-signées S3 ou signées CloudFront.
 * - driver "local" : dossier disque servi par l'API (route /files) avec des URL signées HMAC.
 *   Pratique pour développer sans Docker, à ne pas utiliser en production.
 */
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  getText(key: string): Promise<string>;
  /** URL de lecture temporaire pour un objet privé (segments audio). */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}

function encodeKey(key: string) {
  return key.split('/').map(encodeURIComponent).join('/');
}

class S3Storage implements Storage {
  private client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
        : undefined,
  });

  private cloudFront =
    env.CLOUDFRONT_DOMAIN && env.CLOUDFRONT_KEY_PAIR_ID && env.CLOUDFRONT_PRIVATE_KEY_PATH
      ? {
          domain: env.CLOUDFRONT_DOMAIN.replace(/\/$/, ''),
          keyPairId: env.CLOUDFRONT_KEY_PAIR_ID,
          privateKey: readFileSync(env.CLOUDFRONT_PRIVATE_KEY_PATH, 'utf8'),
        }
      : null;

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getText(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    if (!res.Body) throw new Error(`Objet vide : ${key}`);
    return res.Body.transformToString('utf8');
  }

  async signedUrl(key: string, ttlSeconds: number) {
    if (this.cloudFront) {
      const domain = this.cloudFront.domain.startsWith('http') ? this.cloudFront.domain : `https://${this.cloudFront.domain}`;
      return getCloudFrontSignedUrl({
        url: `${domain}/${encodeKey(key)}`,
        keyPairId: this.cloudFront.keyPairId,
        privateKey: this.cloudFront.privateKey,
        dateLessThan: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      });
    }
    return getS3SignedUrl(this.client, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }
}

class LocalStorage implements Storage {
  constructor(private root: string) {}

  resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error(`Clé de stockage invalide : ${key}`);
    return full;
  }

  async put(key: string, body: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async getText(key: string) {
    return readFile(this.resolve(key), 'utf8');
  }

  async signedUrl(key: string, ttlSeconds: number) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `${env.PUBLIC_API_URL}/files/${encodeKey(key)}?exp=${exp}&sig=${localSignature(key, exp)}`;
  }
}

function localSignature(key: string, exp: number) {
  return createHmac('sha256', env.JWT_SECRET).update(`${key}:${exp}`).digest('base64url');
}

export function verifyLocalSignature(key: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const expected = Buffer.from(localSignature(key, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const localStorage = new LocalStorage(paths.localStorageDir);
export const storage: Storage = env.STORAGE_DRIVER === 'local' ? localStorage : new S3Storage();

/** Préfixe public : seules les pochettes peuvent être servies sans signature. */
export const PUBLIC_PREFIX = 'covers/';

/**
 * URL publique d'une image (pochette). Si PUBLIC_ASSETS_URL est défini (bucket public / CDN),
 * l'URL est directe ; sinon elle passe par l'API qui redirige vers une URL signée.
 */
export function assetUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  // Pochettes des catalogues externes : déjà une URL publique.
  if (/^https?:\/\//.test(key)) return key;
  if (env.PUBLIC_ASSETS_URL && env.STORAGE_DRIVER === 's3') return `${env.PUBLIC_ASSETS_URL.replace(/\/$/, '')}/${encodeKey(key)}`;
  return `${env.PUBLIC_API_URL}/assets/${encodeKey(key)}`;
}
