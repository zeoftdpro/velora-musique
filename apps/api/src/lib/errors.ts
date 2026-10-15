export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Ressource') => new HttpError(404, `${what} introuvable`, 'NOT_FOUND');
export const forbidden = (message = 'Accès refusé') => new HttpError(403, message, 'FORBIDDEN');
export const unauthorized = (message = 'Authentification requise') => new HttpError(401, message, 'UNAUTHORIZED');
export const conflict = (message: string) => new HttpError(409, message, 'CONFLICT');
