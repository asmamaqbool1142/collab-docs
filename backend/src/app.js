import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { HttpError } from './errors.js';
import { sanitizeContent } from './sanitize.js';
import { importFile, SUPPORTED_EXTENSIONS } from './importers.js';

export const MAX_TITLE_LENGTH = 200;
export const MAX_CONTENT_BYTES = 1_000_000;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ROLES = ['viewer', 'editor'];

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function validateTitle(title) {
  if (typeof title !== 'string') throw new HttpError(400, 'Title must be a string');
  const trimmed = title.trim();
  if (!trimmed) throw new HttpError(400, 'Title cannot be empty');
  if (trimmed.length > MAX_TITLE_LENGTH) throw new HttpError(400, `Title must be at most ${MAX_TITLE_LENGTH} characters`);
  return trimmed;
}

function validateContent(content) {
  if (typeof content !== 'string') throw new HttpError(400, 'Content must be a string');
  if (Buffer.byteLength(content) > MAX_CONTENT_BYTES) throw new HttpError(413, 'Document is too large');
  return sanitizeContent(content);
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Document not found');
  return id;
}

export function createApp(db, { frontendDist } = {}) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userByToken: db.prepare(
      'SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
    ),
    insertSession: db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    listUsers: db.prepare('SELECT id, email, name FROM users ORDER BY name'),
    ownedDocs: db.prepare(
      `SELECT id, title, updated_at, created_at,
              (SELECT COUNT(*) FROM document_shares s WHERE s.document_id = d.id) AS share_count
         FROM documents d WHERE owner_id = ? ORDER BY updated_at DESC, id DESC`,
    ),
    sharedDocs: db.prepare(
      `SELECT d.id, d.title, d.updated_at, d.created_at, s.role,
              u.name AS owner_name, u.email AS owner_email
         FROM document_shares s
         JOIN documents d ON d.id = s.document_id
         JOIN users u ON u.id = d.owner_id
        WHERE s.user_id = ? ORDER BY d.updated_at DESC, d.id DESC`,
    ),
    docById: db.prepare(
      `SELECT d.*, u.name AS owner_name, u.email AS owner_email
         FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = ?`,
    ),
    shareRole: db.prepare('SELECT role FROM document_shares WHERE document_id = ? AND user_id = ?'),
    insertDoc: db.prepare('INSERT INTO documents (owner_id, title, content) VALUES (?, ?, ?)'),
    updateDoc: db.prepare("UPDATE documents SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?"),
    deleteDoc: db.prepare('DELETE FROM documents WHERE id = ?'),
    sharesForDoc: db.prepare(
      `SELECT u.id AS user_id, u.email, u.name, s.role
         FROM document_shares s JOIN users u ON u.id = s.user_id
        WHERE s.document_id = ? ORDER BY u.name`,
    ),
    upsertShare: db.prepare(
      `INSERT INTO document_shares (document_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT (document_id, user_id) DO UPDATE SET role = excluded.role`,
    ),
    deleteShare: db.prepare('DELETE FROM document_shares WHERE document_id = ? AND user_id = ?'),
  };

  // ---------- auth ----------
  function requireAuth(req, _res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token && q.userByToken.get(token);
    if (!user) return next(new HttpError(401, 'Please sign in'));
    req.user = user;
    req.token = token;
    next();
  }

  /** Load a document and the caller's role on it. Missing and forbidden both 404 to avoid leaking existence. */
  function loadDoc(req, { need = 'viewer' } = {}) {
    const doc = q.docById.get(parseId(req.params.id));
    if (!doc) throw new HttpError(404, 'Document not found');
    const role = doc.owner_id === req.user.id ? 'owner' : q.shareRole.get(doc.id, req.user.id)?.role;
    if (!role) throw new HttpError(404, 'Document not found');
    if (need === 'editor' && role === 'viewer') throw new HttpError(403, 'You have view-only access to this document');
    if (need === 'owner' && role !== 'owner') throw new HttpError(403, 'Only the owner can do that');
    return { doc, role };
  }

  function serializeDoc(doc, role) {
    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      owner: { id: doc.owner_id, name: doc.owner_name, email: doc.owner_email },
      role,
      shares: role === 'owner' ? q.sharesForDoc.all(doc.id) : undefined,
    };
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      throw new HttpError(400, 'Email and password are required');
    }
    const user = q.userByEmail.get(email.trim());
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw new HttpError(401, 'Invalid email or password');
    }
    const token = crypto.randomBytes(32).toString('hex');
    q.insertSession.run(token, user.id);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    q.deleteSession.run(req.token);
    res.status(204).end();
  });

  app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

  app.get('/api/users', requireAuth, (_req, res) => res.json({ users: q.listUsers.all() }));

  // ---------- documents ----------
  app.get('/api/documents', requireAuth, (req, res) => {
    res.json({ owned: q.ownedDocs.all(req.user.id), shared: q.sharedDocs.all(req.user.id) });
  });

  app.post('/api/documents', requireAuth, (req, res) => {
    const { title = 'Untitled document', content = '' } = req.body ?? {};
    const info = q.insertDoc.run(req.user.id, validateTitle(title), validateContent(content));
    res.status(201).json(serializeDoc(q.docById.get(info.lastInsertRowid), 'owner'));
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  app.post(
    '/api/documents/import',
    requireAuth,
    upload.single('file'),
    asyncRoute(async (req, res) => {
      if (!req.file) throw new HttpError(400, `Attach a file (${SUPPORTED_EXTENSIONS.join(', ')})`);
      const { title, content } = await importFile(req.file);
      const info = q.insertDoc.run(req.user.id, title, content);
      res.status(201).json(serializeDoc(q.docById.get(info.lastInsertRowid), 'owner'));
    }),
  );

  app.get('/api/documents/:id', requireAuth, (req, res) => {
    const { doc, role } = loadDoc(req);
    res.json(serializeDoc(doc, role));
  });

  app.patch('/api/documents/:id', requireAuth, (req, res) => {
    const { doc, role } = loadDoc(req, { need: 'editor' });
    const body = req.body ?? {};
    if (body.title === undefined && body.content === undefined) {
      throw new HttpError(400, 'Nothing to update — send title and/or content');
    }
    const title = body.title !== undefined ? validateTitle(body.title) : doc.title;
    const content = body.content !== undefined ? validateContent(body.content) : doc.content;
    q.updateDoc.run(title, content, doc.id);
    res.json(serializeDoc(q.docById.get(doc.id), role));
  });

  app.delete('/api/documents/:id', requireAuth, (req, res) => {
    const { doc } = loadDoc(req, { need: 'owner' });
    q.deleteDoc.run(doc.id);
    res.status(204).end();
  });

  // ---------- sharing ----------
  app.post('/api/documents/:id/shares', requireAuth, (req, res) => {
    const { doc } = loadDoc(req, { need: 'owner' });
    const { email, role = 'viewer' } = req.body ?? {};
    if (typeof email !== 'string' || !email.trim()) throw new HttpError(400, 'Email is required');
    if (!ROLES.includes(role)) throw new HttpError(400, `Role must be one of: ${ROLES.join(', ')}`);
    const target = q.userByEmail.get(email.trim());
    if (!target) throw new HttpError(404, `No user with email ${email.trim()}`);
    if (target.id === doc.owner_id) throw new HttpError(400, 'You already own this document');
    q.upsertShare.run(doc.id, target.id, role);
    res.status(201).json({ shares: q.sharesForDoc.all(doc.id) });
  });

  app.delete('/api/documents/:id/shares/:userId', requireAuth, (req, res) => {
    const { doc } = loadDoc(req, { need: 'owner' });
    const info = q.deleteShare.run(doc.id, Number(req.params.userId));
    if (info.changes === 0) throw new HttpError(404, 'That user does not have access');
    res.json({ shares: q.sharesForDoc.all(doc.id) });
  });

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // ---------- static frontend (production) ----------
  if (frontendDist && fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
  }

  // ---------- errors ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const message = err.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` : err.message;
      return res.status(status).json({ error: message });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
    const status = err.status && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
  });

  return app;
}
