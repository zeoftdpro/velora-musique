import { z } from 'zod';

/** Valide une entrée de requête ; une ZodError est convertie en 400 par le gestionnaire d'erreurs. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export const IdParams = z.object({ id: z.string().uuid('Identifiant invalide') });
export const Pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});
