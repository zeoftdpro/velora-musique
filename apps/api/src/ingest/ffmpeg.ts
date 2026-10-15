import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { env } from '../config.js';

const require = createRequire(import.meta.url);

export function ffmpegPath(): string {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  const bundled = require('ffmpeg-static') as string | null;
  if (!bundled) throw new Error('ffmpeg introuvable : installez ffmpeg ou renseignez FFMPEG_PATH');
  return bundled;
}

export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (chunk) => (stderr += chunk));
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg a échoué (code ${code}) : ${stderr.trim().slice(-800)}`)),
    );
  });
}
