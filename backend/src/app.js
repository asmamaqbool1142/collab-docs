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
// Netlify Functions cap request payloads at ~6 MB and binary uploads arrive base64-encoded (+33%).
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ROLES = ['viewer', 'editor'];

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) throw new HttpError(404, 'Document not found');
  return id;
}

const normalizeEmail = (email) => email.trim().toLowerCase();

/**
 * @param db  object with `query(text, params) → Promise<{ rows, rowCount }>` (see db.js)
 * @param opts.frontendDist  serve the built React app from here (local/Node hosting; Netlify serves it itself)
 */
export function createApp(db, { frontendDist } = {}) {
  const one = async (text, params) => (await db.query(text, params)).rows[0];
  const all = async (text, params) => (await db.query(text, params)).rows;

  const q = {
    userByEmail: (email) => one('SELECT * FROM users WHERE email = $1', [email]),
    userByToken: (token) =>
      one('SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1', [token]),
    insertSession: (token, userId) => db.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]),
    deleteSession: (token) => db.query('DELETE FROM sessions WHERE token = $1', [token]),
    listUsers: () => all('SELECT id, email, name FROM users ORDER BY name'),
    ownedDocs: (userId) =>
      all(
        `SELECT id, title, updated_at, created_at,
                (SELECT COUNT(*)::int FROM document_shares s WHERE s.document_id = d.id) AS share_count
           FROM documents d WHERE owner_id = $1 ORDER BY updated_at DESC, id DESC`,
        [userId],
      ),
    sharedDocs: (userId) =>
      all(
        `SELECT d.id, d.title, d.updated_at, d.created_at, s.role,
                u.name AS owner_name, u.email AS owner_email
           FROM document_shares s
           JOIN documents d ON d.id = s.document_id
           JOIN users u ON u.id = d.owner_id
          WHERE s.user_id = $1 ORDER BY d.updated_at DESC, d.id DESC`,
        [userId],
      ),
    docById: (id) =>
      one(
        `SELECT d.*, u.name AS owner_name, u.email AS owner_email
           FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = $1`,
        [id],
      ),
    shareRole: (docId, userId) =>
      one('SELECT role FROM document_shares WHERE document_id = $1 AND user_id = $2', [docId, userId]),
    insertDoc: (ownerId, title, content) =>
      one('INSERT INTO documents (owner_id, title, content) VALUES ($1, $2, $3) RETURNING id', [ownerId, title, content]),
    updateDoc: (id, title, content) =>
      db.query('UPDATE documents SET title = $1, content = $2, updated_at = now() WHERE id = $3', [title, content, id]),
    deleteDoc: (id) => db.query('DELETE FROM documents WHERE id = $1', [id]),
    sharesForDoc: (docId) =>
      all(
        `SELECT u.id AS user_id, u.email, u.name, s.role
           FROM document_shares s JOIN users u ON u.id = s.user_id
          WHERE s.document_id = $1 ORDER BY u.name`,
        [docId],
      ),
    upsertShare: (docId, userId, role) =>
      db.query(
        `INSERT INTO document_shares (document_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (document_id, user_id) DO UPDATE SET role = excluded.role`,
        [docId, userId, role],
      ),
    deleteShare: (docId, userId) =>
      db.query('DELETE FROM document_shares WHERE document_id = $1 AND user_id = $2', [docId, userId]),
  };

  const app = express();

  // On Netlify, /api/* is rewritten to /.netlify/functions/api/*; map it back so routes stay the same.
  app.use((req, _res, next) => {
    if (req.url.startsWith('/.netlify/functions/api')) req.url = '/api' + req.url.slice('/.netlify/functions/api'.length);
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  // ---------- auth ----------
  const requireAuth = route(async (req, _res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token && (await q.userByToken(token));
    if (!user) throw new HttpError(401, 'Please sign in');
    req.user = user;
    req.token = token;
    next();
  });

  /** Load a document and the caller's role on it. Missing and forbidden both 404 to avoid leaking existence. */
  async function loadDoc(req, { need = 'viewer' } = {}) {
    const doc = await q.docById(parseId(req.params.id));
    if (!doc) throw new HttpError(404, 'Document not found');
    const role = doc.owner_id === req.user.id ? 'owner' : (await q.shareRole(doc.id, req.user.id))?.role;
    if (!role) throw new HttpError(404, 'Document not found');
    if (need === 'editor' && role === 'viewer') throw new HttpError(403, 'You have view-only access to this document');
    if (need === 'owner' && role !== 'owner') throw new HttpError(403, 'Only the owner can do that');
    return { doc, role };
  }

  async function serializeDoc(doc, role) {
    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      owner: { id: doc.owner_id, name: doc.owner_name, email: doc.owner_email },
      role,
      shares: role === 'owner' ? await q.sharesForDoc(doc.id) : undefined,
    };
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/auth/login', route(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      throw new HttpError(400, 'Email and password are required');
    }
    const user = await q.userByEmail(normalizeEmail(email));
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw new HttpError(401, 'Invalid email or password');
    }
    const token = crypto.randomBytes(32).toString('hex');
    await q.insertSession(token, user.id);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  }));

  app.post('/api/auth/logout', requireAuth, route(async (req, res) => {
    await q.deleteSession(req.token);
    res.status(204).end();
  }));

  app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

  app.get('/api/users', requireAuth, route(async (_req, res) => res.json({ users: await q.listUsers() })));

  // ---------- documents ----------
  app.get('/api/documents', requireAuth, route(async (req, res) => {
    const [owned, shared] = await Promise.all([q.ownedDocs(req.user.id), q.sharedDocs(req.user.id)]);
    res.json({ owned, shared });
  }));

  app.post('/api/documents', requireAuth, route(async (req, res) => {
    const { title = 'Untitled document', content = '' } = req.body ?? {};
    const { id } = await q.insertDoc(req.user.id, validateTitle(title), validateContent(content));
    res.status(201).json(await serializeDoc(await q.docById(id), 'owner'));
  }));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  app.post('/api/documents/import', requireAuth, upload.single('file'), route(async (req, res) => {
    if (!req.file) throw new HttpError(400, `Attach a file (${SUPPORTED_EXTENSIONS.join(', ')})`);
    const { title, content } = await importFile(req.file);
    const { id } = await q.insertDoc(req.user.id, title, content);
    res.status(201).json(await serializeDoc(await q.docById(id), 'owner'));
  }));

  app.get('/api/documents/:id', requireAuth, route(async (req, res) => {
    const { doc, role } = await loadDoc(req);
    res.json(await serializeDoc(doc, role));
  }));

  app.patch('/api/documents/:id', requireAuth, route(async (req, res) => {
    const { doc, role } = await loadDoc(req, { need: 'editor' });
    const body = req.body ?? {};
    if (body.title === undefined && body.content === undefined) {
      throw new HttpError(400, 'Nothing to update — send title and/or content');
    }
    const title = body.title !== undefined ? validateTitle(body.title) : doc.title;
    const content = body.content !== undefined ? validateContent(body.content) : doc.content;
    await q.updateDoc(doc.id, title, content);
    res.json(await serializeDoc(await q.docById(doc.id), role));
  }));

  app.delete('/api/documents/:id', requireAuth, route(async (req, res) => {
    const { doc } = await loadDoc(req, { need: 'owner' });
    await q.deleteDoc(doc.id);
    res.status(204).end();
  }));

  // ---------- sharing ----------
  app.post('/api/documents/:id/shares', requireAuth, route(async (req, res) => {
    const { doc } = await loadDoc(req, { need: 'owner' });
    const { email, role = 'viewer' } = req.body ?? {};
    if (typeof email !== 'string' || !email.trim()) throw new HttpError(400, 'Email is required');
    if (!ROLES.includes(role)) throw new HttpError(400, `Role must be one of: ${ROLES.join(', ')}`);
    const target = await q.userByEmail(normalizeEmail(email));
    if (!target) throw new HttpError(404, `No user with email ${email.trim()}`);
    if (target.id === doc.owner_id) throw new HttpError(400, 'You already own this document');
    await q.upsertShare(doc.id, target.id, role);
    res.status(201).json({ shares: await q.sharesForDoc(doc.id) });
  }));

  app.delete('/api/documents/:id/shares/:userId', requireAuth, route(async (req, res) => {
    const { doc } = await loadDoc(req, { need: 'owner' });
    const userId = Number(req.params.userId);
    const result = Number.isInteger(userId) ? await q.deleteShare(doc.id, userId) : { rowCount: 0 };
    if (result.rowCount === 0) throw new HttpError(404, 'That user does not have access');
    res.json({ shares: await q.sharesForDoc(doc.id) });
  }));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // ---------- static frontend (local / plain Node hosting) ----------
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
