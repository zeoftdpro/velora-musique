import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { BootScreen } from './components/States';
import { AuthProvider, useAuth } from './context/auth';
import { LibraryProvider } from './context/library';
import { PlayerProvider } from './context/player';
import { ToastProvider } from './context/toast';
import { AccountPage } from './pages/Account';
import { AlbumPage } from './pages/Album';
import { ArtistPage } from './pages/Artist';
import { AuthPage } from './pages/Auth';
import { HomePage } from './pages/Home';
import { LibraryPage, LikedPage } from './pages/Library';
import { PlaylistPage } from './pages/Playlist';
import { SearchPage } from './pages/Search';
import { setupPwa } from './pwa';
import './styles.css';

setupPwa();

/** Espace connecté : la bibliothèque et le lecteur n'existent que pour un utilisateur authentifié. */
function Protected() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <BootScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return (
    <LibraryProvider key={user.id}>
      <PlayerProvider>
        <Layout />
      </PlayerProvider>
    </LibraryProvider>
  );
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <BootScreen />;
  return user ? <Navigate to="/" replace /> : children;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
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
              <Route path="account" element={<AccountPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
