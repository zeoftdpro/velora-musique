import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, keepServerAwake, onUnauthorized, refreshSession, setAccessToken, type Session, type User } from '../api';

type AuthState = {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const applySession = useCallback((session: Session) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
  }, []);

  // Au chargement : tente de restaurer la session grâce au cookie de rafraîchissement.
  useEffect(() => {
    onUnauthorized(() => {
      setAccessToken(null);
      setUser(null);
    });
    // Réveille d'abord le serveur (requête réessayable) : le rafraîchissement de session, lui, n'est pas rejoué.
    api
      .health()
      .catch(() => undefined)
      .then(() => refreshSession())
      .then((s) => s && applySession(s))
      .finally(() => setReady(true));
    return keepServerAwake();
  }, [applySession]);

  // Rafraîchit le jeton d'accès un peu avant son expiration.
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => refreshSession().then((s) => s && setUser(s.user)), 12 * 60 * 1000);
    return () => clearInterval(id);
  }, [user]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      setUser,
      login: async (email, password) => applySession(await api.login({ email, password })),
      register: async (email, password, displayName) => applySession(await api.register({ email, password, displayName })),
      logout: async () => {
        await api.logout().catch(() => undefined);
        setAccessToken(null);
        setUser(null);
      },
    }),
    [user, ready, applySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
