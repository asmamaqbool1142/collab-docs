import { useEffect, useState } from 'react';
import { api } from '../services/api.js';

export default function SharePanel({ docId, shares, onChange, onClose }) {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.users().then((r) => setUsers(r.users)).catch(() => {}); }, []);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      const res = await fn();
      onChange(res.shares);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e) => {
    e.preventDefault();
    if (!email.trim()) return setError('Enter an email address');
    if (await run(() => api.share(docId, email.trim(), role))) setEmail('');
  };

  return (
    <aside className="card share-panel">
      <div className="share-head">
        <h3>Share document</h3>
        <button className="btn-ghost small" onClick={onClose} aria-label="Close share panel">✕</button>
      </div>
      <form onSubmit={add} className="share-form">
        <input type="email" list="known-users" placeholder="name@example.com" value={email}
          onChange={(e) => setEmail(e.target.value)} aria-label="Email to share with" />
        <datalist id="known-users">
          {users.map((u) => <option key={u.id} value={u.email}>{u.name}</option>)}
        </datalist>
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Access level">
          <option value="viewer">Can view</option>
          <option value="editor">Can edit</option>
        </select>
        <button className="btn-primary" disabled={busy}>Add</button>
      </form>
      {error && <div className="error small">{error}</div>}
      <h4 className="muted small">People with access</h4>
      {shares.length === 0 ? <p className="muted small">Only you can see this document.</p> : (
        <ul className="share-list">
          {shares.map((s) => (
            <li key={s.user_id}>
              <div>
                <div>{s.name}</div>
                <div className="muted small">{s.email}</div>
              </div>
              <select value={s.role} disabled={busy} aria-label={`Access for ${s.name}`}
                onChange={(e) => run(() => api.share(docId, s.email, e.target.value))}>
                <option value="viewer">Can view</option>
                <option value="editor">Can edit</option>
              </select>
              <button className="btn-ghost danger small" disabled={busy}
                onClick={() => run(() => api.unshare(docId, s.user_id))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Demo accounts: alice@, bob@, carol@example.com</p>
    </aside>
  );
}
