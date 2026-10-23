import type { LyricLine, Lyrics } from './api';

/**
 * Paroles Genius lues par le navigateur, quand Genius refuse le serveur : son fichier d'intégration (embed.js)
 * est ouvert à tous les sites. Il contient `document.write(JSON.parse('…'))` : une chaîne JavaScript, qui
 * contient du JSON, qui contient le HTML des paroles.
 */
export async function geniusLyricsInBrowser(songId: number, durationMs: number): Promise<Lyrics | null> {
  const res = await fetch(`https://genius.com/songs/${songId}/embed.js`);
  if (!res.ok) return null;
  const literal = (await res.text()).match(/JSON\.parse\('((?:[^'\\]|\\.)*)'\)/)?.[1];
  if (!literal) return null;
  const html = JSON.parse(literal.replace(/\\(.)/g, '$1')) as string;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.querySelector('.rg_embed_body');
  if (!body) return null;
  body.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  const plain = (body.textContent ?? '')
    .split('\n')
    .map((l) => l.trim())
    // Repères de structure (« [Couplet 1] ») : une pause entre les parties.
    .map((l) => (/^\[.*\]$/.test(l) ? '' : l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (plain.split('\n').filter(Boolean).length < 4) return null;
  return { synced: estimateSync(plain, durationMs), plain, estimated: true };
}

/** Même estimation que le serveur : lignes réparties sur la durée au prorata de leur longueur, pauses entre couplets. */
function estimateSync(plain: string, durationMs: number): LyricLine[] {
  const parts: { text: string; weight: number }[] = [];
  for (const raw of plain.split('\n')) {
    const text = raw.trim();
    if (text) parts.push({ text, weight: text.length + 8 });
    else if (parts.length && parts.at(-1)!.text) parts.push({ text: '', weight: 22 });
  }
  while (parts.length && !parts.at(-1)!.text) parts.pop();
  const total = parts.reduce((n, p) => n + p.weight, 0) || 1;
  const start = Math.min(15_000, Math.max(4_000, durationMs * 0.05));
  const end = durationMs - Math.min(15_000, Math.max(5_000, durationMs * 0.06));
  const span = Math.max(end - start, 1);
  let at = start;
  return parts.map((p) => {
    const line = { time: Math.round(at), text: p.text };
    at += (p.weight / total) * span;
    return line;
  });
}
