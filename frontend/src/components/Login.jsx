import { useState } from 'react';
import { api } from '../services/api.js';

const DEMO = [
  { email: 'alice@example.com', name: 'Alice Owner' },
  { email: 'bob@example.com', name: 'Bob Collaborator' },
  { email: 'carol@example.com', name: 'Carol Reviewer' },
];

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e, creds = { email, password }) => {
    e?.preventDefault();
    setError('');
    if (!creds.email.trim() || !creds.password) return setError('Enter an email and password');
    setBusy(true);
    try {
      const { token, user } = await api.login(creds.email.trim(), creds.password);
      onLogin(token, user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1>📝 Docs</h1>
        <p className="muted">Sign in to create, edit and share documents.</p>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="demo">
          <p className="muted small">Demo accounts (password <code>password123</code>) — click to sign in:</p>
          {DEMO.map((u) => (
            <button type="button" key={u.email} className="btn-ghost demo-user" disabled={busy}
              onClick={() => submit(null, { email: u.email, password: 'password123' })}>
              {u.name} <span className="muted small">{u.email}</span>
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
