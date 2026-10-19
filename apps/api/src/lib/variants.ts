/** Variantes HLS produites par l'ingestion, de la plus légère à la plus riche (choix automatique par le lecteur). */
export const VARIANTS = {
  '64k': { bandwidth: 72_000 },
  '128k': { bandwidth: 140_000 },
  // Qualité unique des musiques téléversées : très bonne qualité pour un encombrement réduit.
  '192k': { bandwidth: 206_000 },
  '256k': { bandwidth: 272_000 },
} as const;
export type VariantName = keyof typeof VARIANTS;

/** Variantes encodées reconnues, toutes accessibles. */
export function availableVariants(available: string[]): VariantName[] {
  return available.filter((v): v is VariantName => v in VARIANTS);
}
