import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { api } from '../services/api.js';
import Toolbar from './Toolbar.jsx';
import SharePanel from './SharePanel.jsx';
import { formatDate } from '../utils/format.js';

const AUTOSAVE_MS = 1000;
const STATUS_TEXT = {
  saved: 'All changes saved',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Save failed',
};

export default function DocEditor({ id }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getDoc(id).then(setDoc).catch((e) => setError(e.status === 404 ? 'This document does not exist or you do not have access to it.' : e.message));
  }, [id]);

  if (error) return <div className="container"><div className="error">{error}</div><a href="#/">← Back to documents</a></div>;
  if (!doc) return <div className="container muted">Loading…</div>;
  return <LoadedEditor initial={doc} />;
}

function LoadedEditor({ initial }) {
  const canEdit = initial.role !== 'viewer';
  const isOwner = initial.role === 'owner';
  const [title, setTitle] = useState(initial.title);
  const [savedTitle, setSavedTitle] = useState(initial.title);
  const [status, setStatus] = useState('saved');
  const [saveError, setSaveError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(initial.updatedAt);
  const [shares, setShares] = useState(initial.shares ?? []);
  const [showShare, setShowShare] = useState(false);

  // Save pipeline: at most one request in flight; if edits arrive meanwhile, save again afterwards.
  const pending = useRef(null);   // latest unsaved patch
  const inFlight = useRef(false);
  const timer = useRef(null);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (inFlight.current || !pending.current) return;
    const patch = pending.current;
    pending.current = null;
    inFlight.current = true;
    setStatus('saving');
    let failed = false;
    try {
      const saved = await api.updateDoc(initial.id, patch);
      setUpdatedAt(saved.updatedAt);
      setSavedTitle(saved.title);
      setSaveError('');
      setStatus(pending.current ? 'dirty' : 'saved');
    } catch (e) {
      // Put the failed patch back (merged under any newer edits) so a retry or the next edit resends it.
      pending.current = { ...patch, ...pending.current };
      failed = true;
      setSaveError(e.message);
      setStatus('error');
    } finally {
      inFlight.current = false;
      if (pending.current && !failed) timer.current = setTimeout(flush, AUTOSAVE_MS);
    }
  }, [initial.id]);

  const queue = useCallback((patch, immediate = false) => {
    pending.current = { ...pending.current, ...patch };
    setStatus('dirty');
    clearTimeout(timer.current);
    if (immediate) flush();
    else timer.current = setTimeout(flush, AUTOSAVE_MS);
  }, [flush]);

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, code: false, codeBlock: false }), Underline],
    content: initial.content,
    editable: canEdit,
    onUpdate: ({ editor }) => queue({ content: editor.getHTML() }),
  });

  // Ctrl/Cmd+S saves immediately; warn before leaving with unsaved edits.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (canEdit) flush();
      }
    };
    const onUnload = (e) => {
      if (pending.current || inFlight.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
      // Best effort save when navigating away inside the app.
      if (pending.current) api.updateDoc(initial.id, pending.current).catch(() => {});
      clearTimeout(timer.current);
    };
  }, [canEdit, flush, initial.id]);

  const commitTitle = () => {
    const t = title.trim();
    if (!t) {
      setTitle(savedTitle);
      setSaveError('Title cannot be empty — reverted.');
      return;
    }
    if (t.length > 200) {
      setSaveError('Title must be at most 200 characters.');
      return;
    }
    if (t !== savedTitle) queue({ title: t }, true);
  };

  return (
    <div className="editor-page">
      <div className="doc-header">
        <a href="#/" className="btn-ghost back" title="Back to documents">←</a>
        <div className="doc-header-main">
          <input
            className="title-input"
            value={title}
            maxLength={200}
            disabled={!canEdit}
            aria-label="Document title"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <div className="doc-meta small muted">
            {isOwner ? <span className="badge badge-owner">Owner</span> : (
              <>
                <span className="badge badge-shared">Shared by {initial.owner.name}</span>{' '}
                <span className={`badge badge-${initial.role}`}>{initial.role === 'editor' ? 'Can edit' : 'View only'}</span>
              </>
            )}
            {canEdit && (
              <span className={`status status-${status}`} title={saveError}>
                {STATUS_TEXT[status]}{status === 'error' && ` — ${saveError}`}
              </span>
            )}
            <span>Last saved {formatDate(updatedAt)}</span>
          </div>
        </div>
        <div className="doc-header-actions">
          {canEdit && (
            <button className="btn" onClick={flush} disabled={status === 'saved' || status === 'saving'}>
              {status === 'error' ? 'Retry save' : 'Save'}
            </button>
          )}
          {isOwner && (
            <button className="btn-primary" onClick={() => setShowShare((s) => !s)}>
              Share{shares.length > 0 && ` (${shares.length})`}
            </button>
          )}
        </div>
      </div>
      {saveError && status !== 'error' && <div className="error">{saveError}</div>}
      {canEdit ? <Toolbar editor={editor} /> : <div className="readonly-note">You have view-only access. Ask {initial.owner.name} for edit access.</div>}
      <div className="editor-layout">
        <div className="paper">
          <EditorContent editor={editor} />
        </div>
        {showShare && isOwner && <SharePanel docId={initial.id} shares={shares} onChange={setShares} onClose={() => setShowShare(false)} />}
      </div>
    </div>
  );
}
