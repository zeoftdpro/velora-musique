import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/auth';
import { useLibrary } from '../context/library';
import { useToast } from '../context/toast';
import { usePlayer } from '../context/player';
import { PANEL_MEDIA, useMediaQuery } from '../hooks';
import { useInstall } from '../pwa';
import { FullscreenPlayer } from './FullscreenPlayer';
import { InstallBanner } from './InstallBanner';
import { NowPlayingPanel } from './NowPlaying';
import { PlayerBar } from './PlayerBar';
import { DownloadIcon, HeartIcon, HomeIcon, ImportIcon, LibraryIcon, LogoMark, PlusIcon, SearchIcon, UserIcon } from './icons';

export function Layout() {
  const { user } = useAuth();
  const { playlists, createPlaylist } = useLibrary();
  const navigate = useNavigate();
  const toast = useToast();
  const install = useInstall();
  const { panelOpen } = usePlayer();
  const wide = useMediaQuery(PANEL_MEDIA);
  const showPanel = panelOpen && wide;

  const newPlaylist = async () => {
    try {
      const playlist = await createPlaylist(`Ma playlist n°${playlists.length + 1}`);
      navigate(`/playlist/${playlist.id}`);
    } catch {
      toast('Impossible de créer la playlist');
    }
  };

  return (
    <div className={`app ${showPanel ? 'app--panel' : ''}`}>
      <aside className="sidebar">
        <Link to="/" className="brand"><LogoMark /> <span>Velora</span></Link>
        <nav className="nav">
          <NavLink to="/" end><HomeIcon /> <span>Accueil</span></NavLink>
          <NavLink to="/search"><SearchIcon /> <span>Rechercher</span></NavLink>
          <NavLink to="/library"><LibraryIcon /> <span>Bibliothèque</span></NavLink>
          <NavLink to="/import"><ImportIcon /> <span>Importer</span></NavLink>
          <NavLink to="/account" className="nav__mobile-only"><UserIcon /> <span>Compte</span></NavLink>
        </nav>

        <div className="sidebar__section">
          <div className="sidebar__heading">
            <span>Playlists</span>
            <button className="icon-btn" onClick={newPlaylist} aria-label="Créer une playlist"><PlusIcon size={18} /></button>
          </div>
          <NavLink to="/library/liked" className="sidebar__item">
            <span className="liked-tile"><HeartIcon size={14} filled /></span> Titres likés
          </NavLink>
          {playlists.map((p) => (
            <NavLink key={p.id} to={`/playlist/${p.id}`} className="sidebar__item">{p.name}</NavLink>
          ))}
        </div>

        {install.desktopDownload || install.androidDownload ? (
          <a className="sidebar__install" href={install.desktopDownload ?? install.androidDownload ?? undefined} download>
            <DownloadIcon size={18} /> Installer l’appli
          </a>
        ) : install.canPrompt && (
          <button className="sidebar__install" onClick={install.prompt}>
            <DownloadIcon size={18} /> Installer l’appli
          </button>
        )}
        <NavLink to="/account" className="sidebar__account">
          <span className="avatar">{user?.displayName.slice(0, 1).toUpperCase()}</span>
          <span className="sidebar__account-name">{user?.displayName}</span>
        </NavLink>
      </aside>

      <main className="main">
        <InstallBanner />
        <Outlet />
      </main>

      {showPanel && <NowPlayingPanel />}
      <PlayerBar />
      <FullscreenPlayer />
    </div>
  );
}
