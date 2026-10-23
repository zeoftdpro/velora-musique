import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { BootScreen } from './components/States';
import { AuthProvider, useAuth } from './context/auth';
import { DialogProvider } from './context/dialog';
import { LibraryProvider } from './context/library';
import { PlayerProvider } from './context/player';
import { ToastProvider } from './context/toast';
import { UploadsProvider } from './context/uploads';
import { AccountPage } from './pages/Account';
import { AlbumPage } from './pages/Album';
import { ArtistPage } from './pages/Artist';
import { AuthPage } from './pages/Auth';
import { HomePage } from './pages/Home';
import { ImportPage } from './pages/Import';
import { LibraryPage, LikedPage } from './pages/Library';
import { PlaylistPage } from './pages/Playlist';
import { SearchPage } from './pages/Search';
import { TrackPage } from './pages/Track';
import { setupPwa } from './pwa';
import { initTheme } from './theme';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/geist-mono';
import './styles.css';

initTheme();
setupPwa();
// Netlify (offre gratuite) ajoute un badge non masquable en bas à droite : on lui réserve sa place pour qu'il ne couvre pas le volume.
if (document.querySelector('script[data-nf-variant]')) document.documentElement.classList.add('has-host-badge');

/** Espace connecté : la bibliothèque et le lecteur n'existent que pour un utilisateur authentifié. */
function Protected() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <BootScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return (
    <LibraryProvider key={user.id}>
      <UploadsProvider>
        <PlayerProvider>
          <Layout />
        </PlayerProvider>
      </UploadsProvider>
    </LibraryProvider>
  );
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <BootScreen />;
  // Une fois connecté : retour à la page demandée au départ (lien partagé…), sinon l'accueil.
  const from = (location.state as { from?: string } | null)?.from;
  return user ? <Navigate to={from ?? '/'} replace /> : children;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <DialogProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<GuestOnly><AuthPage mode="login" /></GuestOnly>} />
              <Route path="/register" element={<GuestOnly><AuthPage mode="register" /></GuestOnly>} />
              <Route element={<Protected />}>
                <Route index element={<HomePage />} />
                <Route path="search" element={<SearchPage />} />
                <Route path="library" element={<LibraryPage />} />
                <Route path="library/liked" element={<LikedPage />} />
                <Route path="album/:id" element={<AlbumPage />} />
                <Route path="artist/:id" element={<ArtistPage />} />
                <Route path="playlist/:id" element={<PlaylistPage />} />
                <Route path="track/:id" element={<TrackPage />} />
                <Route path="import" element={<ImportPage />} />
                <Route path="account" element={<AccountPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </AuthProvider>
        </DialogProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
