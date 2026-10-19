const CONFIGURED_API_URL = import.meta.env.VITE_API_URL as string | undefined;
const isLocalPage = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

// Par défaut, même hôte que la page (localhost ou 127.0.0.1) : le cookie de session reste « same-site ».
export const API_URL = CONFIGURED_API_URL ?? `${window.location.protocol}//${window.location.hostname}:4000`;

/**
 * En ligne (Netlify…), l'adresse de l'API doit être fournie au build via VITE_API_URL : sans elle, le site
 * appellerait « ton-site:4000 », qui n'existe pas, et resterait bloqué jusqu'à l'expiration du navigateur.
 */
export const API_CONFIGURED = Boolean(CONFIGURED_API_URL) || isLocalPage;
// L'API tourne sur Vercel (pas de mise en veille) : un échec passager se rattrape en quelques secondes.
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2; // 1 + 2 s
const RETRY_STATUSES = new Set([502, 503, 504]);

// ---------------------------------------------------------------------------
// Types renvoyés par l'API
// ---------------------------------------------------------------------------

export type User = { id: string; email: string; displayName: string };
export type Genre = { id: number; name: string; slug: string; trackCount: number };
export type ArtistRef = { id: string; name: string };
export type Track = {
  id: string;
  title: string;
  durationMs: number;
  trackNumber: number | null;
  artist: ArtistRef;
  album: { id: string; title: string; coverUrl: string | null };
  genre: { name: string; slug: string } | null;
  source: 'local' | 'jamendo' | 'youtube';
  /** Ajouté par la lecture automatique (suggestion), et non choisi par l'utilisateur. */
  suggested?: boolean;
};
export type Album = {
  id: string;
  title: string;
  releaseYear: number | null;
  coverUrl: string | null;
  artist: ArtistRef;
  genre: { name: string; slug: string } | null;
};
export type AlbumDetail = Album & { tracks: Track[] };
export type Artist = { id: string; name: string; bio: string | null; imageUrl: string | null };
export type ArtistDetail = Artist & { albums: Album[]; topTracks: Track[] };
export type PlaylistSummary = {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  trackCount: number;
  /** 'uploads' : catégorie qui reçoit les musiques téléversées. */
  kind: 'uploads' | null;
};
export type UploadTicket = { id: string; uploadUrl: string; contentType: string };
export type PlaylistDetail = PlaylistSummary & { isOwner: boolean; tracks: (Track & { itemId: string })[] };
export type SearchResults = { tracks: Track[]; albums: Album[]; artists: Artist[] };
export type WebSearchResults = { status: 'ok' | 'disabled' | 'quota' | 'error'; tracks: Track[] };
export type Recommendations = { tracks: Track[]; basedOn: string[] };
export type Session = { user: User; accessToken: string; expiresIn: number };

// ---------------------------------------------------------------------------
// Client HTTP : jeton d'accès en mémoire, rafraîchissement automatique via cookie httpOnly
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;
let refreshing: Promise<Session | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function onUnauthorized(handler: () => void) {
  onSessionLost = handler;
}

async function raw<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  if (!API_CONFIGURED) {
    throw new ApiError(0, 'Ce site n’est relié à aucun serveur Velora (variable VITE_API_URL manquante).');
  }
  // Erreur passagère (502/503/504, réseau) : les requêtes sans effet de bord en cas de doublon sont réessayées,
  // avec une attente croissante.
  const retryable = ['GET', 'HEAD', 'PUT', 'DELETE'].includes((init.method ?? 'GET').toUpperCase());
  let res: Response | null = null;
  for (let attempt = 0; ; attempt++) {
    const canRetry = retryable && attempt < MAX_RETRIES;
    try {
      res = await fetch(`${API_URL}${path}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...init, headers, credentials: 'include' });
    } catch {
      res = null;
    }
    if (res && !RETRY_STATUSES.has(res.status)) break;
    if (!canRetry) break;
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  if (!res) {
    // Erreur réseau, CORS ou délai dépassé : le navigateur ne donne que « Failed to fetch ».
    throw new ApiError(0, isLocalPage
      ? 'Impossible de joindre le serveur Velora. Vérifiez que l’API est lancée (npm run dev).'
      : 'Le serveur Velora ne répond pas. Réessayez dans un instant.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.message ?? `Erreur ${res.status}`);
  return data as T;
}

/** Rafraîchit la session (un seul appel concurrent). Renvoie null si la session a expiré. */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= raw<Session | undefined>('/auth/refresh', { method: 'POST' })
    .then((s) => {
      if (!s) return null; // 204 : aucune session ouverte
      setAccessToken(s.accessToken);
      return s;
    })
    .catch(() => null)
    .finally(() => (refreshing = null));
  return refreshing;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await raw<T>(path, init);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401 || path.startsWith('/auth/')) throw err;
    const session = await refreshSession();
    if (!session) {
      onSessionLost?.();
      throw err;
    }
    return raw<T>(path, init);
  }
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  register: (body: { email: string; password: string; displayName: string }) =>
    raw<Session>('/auth/register', { method: 'POST', body: json(body) }),
  login: (body: { email: string; password: string }) => raw<Session>('/auth/login', { method: 'POST', body: json(body) }),
  logout: () => raw<void>('/auth/logout', { method: 'POST' }),
  logoutAll: () => request<void>('/auth/logout-all', { method: 'POST' }),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<Session>('/auth/password', { method: 'POST', body: json(body) }),

  health: () => raw<{ status: string }>('/health'),
  me: () => request<User>('/me'),
  updateMe: (body: { displayName: string }) => request<User>('/me', { method: 'PATCH', body: json(body) }),

  genres: () => request<Genre[]>('/genres'),
  albums: (params: { genre?: string; limit?: number; source?: 'local' | 'all' } = {}) => request<Album[]>(`/albums?${new URLSearchParams(clean(params))}`),
  album: (id: string) => request<AlbumDetail>(`/albums/${id}`),
  artists: (source: 'local' | 'all' = 'all') => request<Artist[]>(`/artists?limit=50&source=${source}`),
  artist: (id: string) => request<ArtistDetail>(`/artists/${id}`),
  tracks: (params: { genre?: string; limit?: number } = {}) => request<Track[]>(`/tracks?${new URLSearchParams(clean(params))}`),
  search: (q: string, genre?: string) => request<SearchResults>(`/search?${new URLSearchParams(clean({ q, genre }))}`),
  searchWeb: (q: string) => request<WebSearchResults>(`/search/web?${new URLSearchParams({ q })}`),

  play: (trackId: string) =>
    request<{ streamUrl: string; format: 'hls' | 'mp3' | 'youtube'; videoId?: string; qualities: string[]; expiresIn: number }>(`/tracks/${trackId}/play`, { method: 'POST' }),

  favorites: () => request<Track[]>('/me/favorites?limit=100'),
  favoriteIds: () => request<string[]>('/me/favorites/ids'),
  addFavorite: (trackId: string) => request<void>(`/me/favorites/${trackId}`, { method: 'PUT' }),
  removeFavorite: (trackId: string) => request<void>(`/me/favorites/${trackId}`, { method: 'DELETE' }),
  history: () => request<Track[]>('/me/history?limit=20'),
  recommendations: () => request<Recommendations>('/me/recommendations?limit=24'),
  /** Titres à enchaîner après `seedId` quand la file d'attente se termine (lecture automatique). */
  radio: (seedId: string, exclude: string[]) =>
    request<Track[]>(`/me/radio?${new URLSearchParams({ seed: seedId, exclude: exclude.join(',') })}`),

  playlists: () => request<PlaylistSummary[]>('/playlists'),
  playlist: (id: string) => request<PlaylistDetail>(`/playlists/${id}`),
  createPlaylist: (body: { name: string; description?: string }) =>
    request<PlaylistSummary>('/playlists', { method: 'POST', body: json(body) }),
  updatePlaylist: (id: string, body: Partial<{ name: string; description: string | null; isPublic: boolean }>) =>
    request<PlaylistSummary>(`/playlists/${id}`, { method: 'PATCH', body: json(body) }),
  deletePlaylist: (id: string) => request<void>(`/playlists/${id}`, { method: 'DELETE' }),
  addToPlaylist: (id: string, trackId: string) =>
    request<void>(`/playlists/${id}/tracks`, { method: 'POST', body: json({ trackId }) }),
  removeFromPlaylist: (id: string, itemId: string) => request<void>(`/playlists/${id}/tracks/${itemId}`, { method: 'DELETE' }),
  movePlaylistItem: (id: string, itemId: string, position: number) =>
    request<void>(`/playlists/${id}/tracks/${itemId}`, { method: 'PATCH', body: json({ position }) }),

  /** Téléversement, étape 1 : URL d'envoi direct vers le stockage. */
  startUpload: (body: { fileName: string; size: number }) => request<UploadTicket>('/uploads', { method: 'POST', body: json(body) }),
  /** Étape 3, après l'envoi : conversion et ajout aux « Musiques téléversées » (jusqu'à une minute pour un long fichier). */
  completeUpload: (id: string, fileName: string) =>
    request<{ playlistId: string; track: Track | null }>(`/uploads/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      body: json({ fileName }),
      signal: AbortSignal.timeout(5 * 60_000),
    }),
};

/**
 * Téléversement, étape 2 : envoie le fichier directement au stockage. XMLHttpRequest plutôt que fetch, qui ne
 * donne pas la progression d'un envoi.
 */
export function putFile(ticket: UploadTicket, file: File, onProgress: (fraction: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', ticket.uploadUrl);
    xhr.setRequestHeader('content-type', ticket.contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, `Envoi refusé (${xhr.status})`)));
    xhr.onerror = () => reject(new ApiError(0, 'Envoi interrompu : vérifiez votre connexion'));
    xhr.send(file);
  });
}

function clean(params: Record<string, string | number | undefined>) {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)]),
  );
}

export function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
