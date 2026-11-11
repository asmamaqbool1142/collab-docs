import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { navigate } from '../services/navigation.js';
import { formatDate } from '../utils/format.js';

export const ACCEPTED = '.txt,.md,.markdown,.docx';

export default function DocList() {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = () => api.listDocs().then(setDocs).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const doc = await api.createDoc('Untitled document');
      navigate(`/doc/${doc.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const doc = await api.importDoc(file);
      navigate(`/doc/${doc.id}`);
    } catch (err) {
      setError(`Import failed: ${err.message}`);
      setBusy(false);
    }
  };

  const remove = async (doc) => {
    if (!confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    try {
      await api.deleteDoc(doc.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="container">
      <div className="list-actions">
        <button className="btn-primary" onClick={create} disabled={busy}>+ New document</button>
        <button className="btn" onClick={() => fileRef.current.click()} disabled={busy}>⤒ Import file</button>
        <input ref={fileRef} type="file" accept={ACCEPTED} hidden onChange={onFile} />
        <span className="muted small">Import supports .txt, .md and .docx (max 5 MB) — creates a new editable document.</span>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {!docs ? (
        !error && <p className="muted">Loading…</p>
      ) : (
        <>
          <section>
            <h2>My documents <span className="badge badge-owner">Owner</span></h2>
            {docs.owned.length === 0 ? (
              <p className="muted empty">You don't have any documents yet. Create one or import a file.</p>
            ) : (
              <ul className="doc-list">
                {docs.owned.map((d) => (
                  <li key={d.id}>
                    <a href={`#/doc/${d.id}`} className="doc-link">
                      <span className="doc-title">{d.title}</span>
                      <span className="muted small">
                        Edited {formatDate(d.updated_at)}
                        {d.share_count > 0 && ` · Shared with ${d.share_count}`}
                      </span>
                    </a>
                    <button className="btn-ghost danger small" onClick={() => remove(d)} aria-label={`Delete ${d.title}`}>Delete</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2>Shared with me <span className="badge badge-shared">Shared</span></h2>
            {docs.shared.length === 0 ? (
              <p className="muted empty">Nothing has been shared with you yet.</p>
            ) : (
              <ul className="doc-list">
                {docs.shared.map((d) => (
                  <li key={d.id}>
                    <a href={`#/doc/${d.id}`} className="doc-link">
                      <span className="doc-title">{d.title}</span>
                      <span className="muted small">
                        Owned by {d.owner_name} · Edited {formatDate(d.updated_at)}
                      </span>
                    </a>
                    <span className={`badge badge-${d.role}`}>{d.role === 'editor' ? 'Can edit' : 'View only'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
