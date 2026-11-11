import { useEffect, useState } from 'react';
import { api, setToken, getToken } from './services/api.js';
import Login from './components/Login.jsx';
import DocList from './components/DocList.jsx';
import DocEditor from './components/DocEditor.jsx';
import { navigate } from './services/navigation.js';

/** Minimal hash router: #/ → list, #/doc/:id → editor. Keeps deep links working after refresh. */
function useRoute() {
  const parse = () => {
    const m = window.location.hash.match(/^#\/doc\/(\d+)/);
    return m ? { name: 'doc', id: Number(m[1]) } : { name: 'list' };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(!!getToken());
  const route = useRoute();

  useEffect(() => {
    if (!getToken()) return;
    api.me()
      .then(({ user }) => setUser(user))
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const onExpired = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const logout = async () => {
    await api.logout().catch(() => {});
    setToken(null);
    setUser(null);
    navigate('/');
  };

  if (checking) return <div className="center muted">Loading…</div>;
  if (!user) return <Login onLogin={(token, u) => { setToken(token); setUser(u); }} />;

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">📝 Docs</a>
        <div className="topbar-right">
          <span className="muted">Signed in as <strong>{user.name}</strong> ({user.email})</span>
          <button className="btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main>
        {route.name === 'doc' ? <DocEditor key={route.id} id={route.id} user={user} /> : <DocList user={user} />}
      </main>
    </div>
  );
}
