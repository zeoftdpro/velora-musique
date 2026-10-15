/**
 * Génère un petit catalogue de démonstration (morceaux synthétisés + pochettes) avec ffmpeg :
 * `npm run demo:generate [-- <dossier>]` puis `npm run ingest -- music/demo`.
 * Aucun fichier sous droits n'est nécessaire pour tester toute la chaîne.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config.js';
import { runFfmpeg } from '../ingest/ffmpeg.js';

type DemoAlbum = {
  artist: string;
  album: string;
  year: number;
  genre: string;
  colors: [string, string];
  /** Accord de base (rapports de fréquence) et tempo de l'arpège. */
  chord: number[];
  tracks: { title: string; root: number; rate: number }[];
};

const MAJOR = [1, 1.26, 1.5, 2];
const MINOR = [1, 1.19, 1.5, 2];
const SUS = [1, 1.335, 1.5, 2.67];

const CATALOG: DemoAlbum[] = [
  {
    artist: 'Nova Lights', album: 'Neon Tides', year: 2024, genre: 'Électro', colors: ['0x7c3aed', '0x06b6d4'], chord: MINOR,
    tracks: [
      { title: 'Midnight Drive', root: 220, rate: 6 },
      { title: 'Glass Horizon', root: 246.94, rate: 8 },
      { title: 'Pulse Garden', root: 196, rate: 6 },
      { title: 'Afterglow', root: 174.61, rate: 4 },
    ],
  },
  {
    artist: 'Nova Lights', album: 'Low Orbit', year: 2025, genre: 'Électro', colors: ['0x0f172a', '0xf43f5e'], chord: SUS,
    tracks: [
      { title: 'Satellite Hearts', root: 207.65, rate: 8 },
      { title: 'Zero Gravity', root: 185, rate: 4 },
    ],
  },
  {
    artist: 'Clara Dumont Trio', album: 'Rue des Lilas', year: 2022, genre: 'Jazz', colors: ['0xb45309', '0xfde68a'], chord: MAJOR,
    tracks: [
      { title: 'Café Crème', root: 261.63, rate: 3 },
      { title: 'Le Pont Bleu', root: 233.08, rate: 2 },
      { title: "Pluie d'été", root: 293.66, rate: 3 },
    ],
  },
  {
    artist: 'Hollow Pines', album: 'Northern Static', year: 2023, genre: 'Ambient', colors: ['0x064e3b', '0x93c5fd'], chord: SUS,
    tracks: [
      { title: 'Frost Signal', root: 130.81, rate: 1 },
      { title: 'Slow Aurora', root: 146.83, rate: 1 },
      { title: 'Pine Echoes', root: 164.81, rate: 2 },
    ],
  },
  {
    artist: 'Les Rivages', album: 'Marée Haute', year: 2025, genre: 'Pop', colors: ['0x1d4ed8', '0xfb923c'], chord: MAJOR,
    tracks: [
      { title: 'Sable Doré', root: 329.63, rate: 4 },
      { title: 'Vent du Large', root: 293.66, rate: 4 },
      { title: 'Phare', root: 261.63, rate: 2 },
    ],
  },
];

const DURATION = 42;

/** Arpège « pluck » sur l'accord + nappe grave modulée lentement. */
function synthExpression(chord: number[], root: number, rate: number) {
  const step = `mod(floor(t*${rate}),${chord.length})`;
  const ratio = chord
    .slice(0, -1)
    .reduceRight((acc, r, i) => `if(eq(${step},${i}),${r},${acc})`, String(chord[chord.length - 1]));
  const pluck = `0.28*sin(2*PI*t*${root}*${ratio})*exp(-${(rate * 1.5).toFixed(1)}*mod(t,${(1 / rate).toFixed(4)}))`;
  const pad = `0.12*sin(2*PI*t*${root / 2})*(0.6+0.4*sin(2*PI*0.125*t))`;
  const shimmer = `0.05*sin(2*PI*t*${root * 3})*(0.5+0.5*sin(2*PI*0.5*t))`;
  return `${pluck}+${pad}+${shimmer}`;
}

const cwd = process.env.INIT_CWD ?? process.cwd();
const outRoot = path.resolve(cwd, process.argv[2] ?? path.join(paths.repoRoot, 'music', 'demo'));

for (const album of CATALOG) {
  const dir = path.join(outRoot, album.artist, album.album);
  await mkdir(dir, { recursive: true });

  await runFfmpeg([
    '-f', 'lavfi',
    '-i', `gradients=s=640x640:c0=${album.colors[0]}:c1=${album.colors[1]}:x0=0:y0=0:x1=640:y1=640:d=1`,
    '-frames:v', '1',
    path.join(dir, 'cover.jpg'),
  ]);

  for (const [i, track] of album.tracks.entries()) {
    const file = path.join(dir, `${String(i + 1).padStart(2, '0')} - ${track.title}.mp3`);
    await runFfmpeg([
      '-f', 'lavfi',
      '-i', `aevalsrc='${synthExpression(album.chord, track.root, track.rate)}|${synthExpression(album.chord, track.root * 1.003, track.rate)}':s=44100:d=${DURATION}`,
      '-af', `afade=t=in:d=1.5,afade=t=out:st=${DURATION - 3}:d=3,aecho=0.8:0.6:${Math.round(1000 / track.rate)}:0.35`,
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      '-metadata', `title=${track.title}`,
      '-metadata', `artist=${album.artist}`,
      '-metadata', `album_artist=${album.artist}`,
      '-metadata', `album=${album.album}`,
      '-metadata', `genre=${album.genre}`,
      '-metadata', `date=${album.year}`,
      '-metadata', `track=${i + 1}/${album.tracks.length}`,
      file,
    ]);
    console.log(`♪ ${path.relative(cwd, file)}`);
  }
}

console.log(`\nCatalogue de démo généré dans ${outRoot}\nÉtape suivante : npm run ingest -- "${path.relative(cwd, outRoot) || '.'}"`);
