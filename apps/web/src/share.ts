import { useCallback } from 'react';
import type { Track } from './api';
import { useToast } from './context/toast';

/** Adresse publique du site : les liens partagés ouvrent le site, ou directement l'appli Android si elle est installée. */
const SITE = window.location.origin;

export const shareUrls = {
  track: (id: string) => `${SITE}/track/${id}`,
  album: (id: string) => `${SITE}/album/${id}`,
  artist: (id: string) => `${SITE}/artist/${id}`,
  playlist: (id: string) => `${SITE}/playlist/${id}`,
};

// Téléphone : la feuille de partage du système (WhatsApp, SMS, Messenger…). Ordinateur : on copie le lien,
// plus attendu que la fenêtre de partage de Windows.
const preferNativeShare = () => typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;

/**
 * Partage un lien. Renvoie 'shared' (feuille de partage), 'copied' (presse-papiers), 'cancelled' (l'utilisateur
 * a fermé la feuille de partage) ou 'failed'.
 */
export async function shareLink(data: { title: string; text: string; url: string }): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  if (preferNativeShare()) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Partage refusé (navigateur intégré…) : on se rabat sur la copie du lien.
    }
  }
  try {
    await navigator.clipboard.writeText(data.url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Message affiché après un partage, ou null s'il n'y a rien à dire (feuille de partage ouverte puis fermée). */
export function shareMessage(result: Awaited<ReturnType<typeof shareLink>>, url: string) {
  if (result === 'copied') return 'Lien copié : collez-le dans un message pour l’envoyer';
  if (result === 'failed') return `Copiez ce lien : ${url}`;
  return null;
}

/** Partage un lien et informe l'utilisateur du résultat. */
export function useShare() {
  const toast = useToast();
  return useCallback(
    async (data: { title: string; text: string; url: string }) => {
      const message = shareMessage(await shareLink(data), data.url);
      if (message) toast(message);
    },
    [toast],
  );
}

/** Partage d'un titre. Une musique téléversée est privée : son lien ne fonctionnerait pas chez un ami. */
export function useShareTrack() {
  const share = useShare();
  const toast = useToast();
  return useCallback(
    (track: Track) => {
      if (track.uploaded) {
        toast('Musique téléversée : elle reste privée et ne peut pas être partagée');
        return;
      }
      void share({
        title: `${track.title} · ${track.artist.name}`,
        text: `Écoute « ${track.title} » de ${track.artist.name} sur Velora`,
        url: shareUrls.track(track.id),
      });
    },
    [share, toast],
  );
}
