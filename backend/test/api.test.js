import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import request from 'supertest';
import { initDb, SEED_PASSWORD } from '../src/db.js';
import { createLocalDb } from '../src/db-local.js';
import { createApp } from '../src/app.js';

let app;
let db;

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: SEED_PASSWORD }).expect(200);
  return { Authorization: `Bearer ${res.body.token}` };
}

// Each test gets a fresh in-memory Postgres (PGlite), so tests run real SQL with no shared state.
beforeEach(async () => {
  db = await initDb(await createLocalDb());
  app = createApp(db);
});

afterEach(async () => {
  await db.close();
});

describe('auth', () => {
  test('rejects wrong password and unauthenticated requests', async () => {
    await request(app).post('/api/auth/login').send({ email: 'alice@example.com', password: 'nope' }).expect(401);
    await request(app).get('/api/documents').expect(401);
  });
});

describe('routing', () => {
  test('Netlify function paths map to the same API routes; email login is case-insensitive', async () => {
    const res = await request(app)
      .post('/.netlify/functions/api/auth/login')
      .send({ email: '  ALICE@Example.com ', password: SEED_PASSWORD })
      .expect(200);
    assert.equal(res.body.user.email, 'alice@example.com');
    await request(app).get('/.netlify/functions/api/documents').set({ Authorization: `Bearer ${res.body.token}` }).expect(200);
  });
});

describe('documents', () => {
  test('create, rename, edit and reopen preserves formatting', async () => {
    const alice = await login('alice@example.com');
    const created = await request(app).post('/api/documents').set(alice).send({ title: 'Plan' }).expect(201);
    const id = created.body.id;

    const html = '<h2>Goals</h2><p><strong>bold</strong> <em>it</em> <u>u</u></p><ul><li>one</li></ul><ol><li>two</li></ol>';
    await request(app).patch(`/api/documents/${id}`).set(alice).send({ title: 'Q3 Plan', content: html }).expect(200);

    const reopened = await request(app).get(`/api/documents/${id}`).set(alice).expect(200);
    assert.equal(reopened.body.title, 'Q3 Plan');
    assert.equal(reopened.body.content, html);
    assert.equal(reopened.body.role, 'owner');
  });

  test('validates title and strips dangerous HTML', async () => {
    const alice = await login('alice@example.com');
    await request(app).post('/api/documents').set(alice).send({ title: '   ' }).expect(400);
    await request(app).post('/api/documents').set(alice).send({ title: 'x'.repeat(201) }).expect(400);

    const res = await request(app)
      .post('/api/documents')
      .set(alice)
      .send({ title: 'XSS', content: '<p onclick="steal()">hi<script>alert(1)</script></p><img src=x onerror=alert(1)>' })
      .expect(201);
    assert.equal(res.body.content, '<p>hi</p>');
  });
});

describe('sharing', () => {
  test('owner shares with viewer, then upgrades to editor; strangers see nothing', async () => {
    const alice = await login('alice@example.com');
    const bob = await login('bob@example.com');
    const carol = await login('carol@example.com');

    const { body: doc } = await request(app).post('/api/documents').set(alice).send({ title: 'Secret' }).expect(201);

    // Before sharing Bob cannot see it (404, not 403, so existence isn't leaked).
    await request(app).get(`/api/documents/${doc.id}`).set(bob).expect(404);

    await request(app).post(`/api/documents/${doc.id}/shares`).set(alice).send({ email: 'bob@example.com', role: 'viewer' }).expect(201);

    const bobList = await request(app).get('/api/documents').set(bob).expect(200);
    assert.equal(bobList.body.owned.length, 0);
    assert.equal(bobList.body.shared.length, 1);
    assert.equal(bobList.body.shared[0].owner_email, 'alice@example.com');
    assert.equal(bobList.body.shared[0].role, 'viewer');

    // Viewer can read but not write, and cannot reshare.
    const asBob = await request(app).get(`/api/documents/${doc.id}`).set(bob).expect(200);
    assert.equal(asBob.body.role, 'viewer');
    assert.equal(asBob.body.shares, undefined, 'non-owners must not see the share list');
    await request(app).patch(`/api/documents/${doc.id}`).set(bob).send({ content: '<p>hack</p>' }).expect(403);
    await request(app).post(`/api/documents/${doc.id}/shares`).set(bob).send({ email: 'carol@example.com' }).expect(403);

    // Upgrade to editor; Bob's edit is visible to Alice.
    await request(app).post(`/api/documents/${doc.id}/shares`).set(alice).send({ email: 'bob@example.com', role: 'editor' }).expect(201);
    await request(app).patch(`/api/documents/${doc.id}`).set(bob).send({ content: '<p>from bob</p>' }).expect(200);
    const asAlice = await request(app).get(`/api/documents/${doc.id}`).set(alice).expect(200);
    assert.equal(asAlice.body.content, '<p>from bob</p>');
    assert.equal(asAlice.body.shares.length, 1);

    // Editors still cannot delete.
    await request(app).delete(`/api/documents/${doc.id}`).set(bob).expect(403);
    // Carol was never granted access.
    await request(app).get(`/api/documents/${doc.id}`).set(carol).expect(404);

    // Revoking removes access.
    await request(app).delete(`/api/documents/${doc.id}/shares/${asAlice.body.shares[0].user_id}`).set(alice).expect(200);
    await request(app).get(`/api/documents/${doc.id}`).set(bob).expect(404);
  });

  test('rejects unknown users, invalid roles and self-shares', async () => {
    const alice = await login('alice@example.com');
    const { body: doc } = await request(app).post('/api/documents').set(alice).send({}).expect(201);
    await request(app).post(`/api/documents/${doc.id}/shares`).set(alice).send({ email: 'ghost@example.com' }).expect(404);
    await request(app).post(`/api/documents/${doc.id}/shares`).set(alice).send({ email: 'bob@example.com', role: 'admin' }).expect(400);
    await request(app).post(`/api/documents/${doc.id}/shares`).set(alice).send({ email: 'alice@example.com' }).expect(400);
  });
});

describe('file import', () => {
  test('markdown upload becomes an editable, formatted document', async () => {
    const alice = await login('alice@example.com');
    const md = '# Title\n\nSome **bold** and *italic*.\n\n- a\n- b\n';
    const res = await request(app)
      .post('/api/documents/import')
      .set(alice)
      .attach('file', Buffer.from(md), 'meeting-notes.md')
      .expect(201);
    assert.equal(res.body.title, 'meeting-notes');
    assert.match(res.body.content, /<h1>Title<\/h1>/);
    assert.match(res.body.content, /<strong>bold<\/strong>/);
    assert.match(res.body.content, /<ul>\s*<li>a<\/li>/);
  });

  test('plain text keeps paragraphs and escapes HTML', async () => {
    const alice = await login('alice@example.com');
    const res = await request(app)
      .post('/api/documents/import')
      .set(alice)
      .attach('file', Buffer.from('line 1\nline 2\n\n<b>not bold</b>'), 'notes.txt')
      .expect(201);
    assert.equal(res.body.content, '<p>line 1<br />line 2</p><p>&lt;b&gt;not bold&lt;/b&gt;</p>');
  });

  test('.docx upload keeps headings, bold and lists', async () => {
    const alice = await login('alice@example.com');
    const file = fs.readFileSync(new URL('./fixtures/report.docx', import.meta.url));
    const res = await request(app).post('/api/documents/import').set(alice).attach('file', file, 'report.docx').expect(201);
    assert.equal(res.body.title, 'report');
    assert.equal(res.body.content, '<h1>Quarterly Report</h1><p>Revenue grew <strong>strongly</strong></p><ul><li>Item A</li><li>Item B</li></ul>');
  });

  test('rejects corrupt .docx with a clear error', async () => {
    const alice = await login('alice@example.com');
    const res = await request(app).post('/api/documents/import').set(alice).attach('file', Buffer.from('not a zip'), 'bad.docx').expect(400);
    assert.match(res.body.error, /valid Word document/);
  });

  test('rejects unsupported types and missing files', async () => {
    const alice = await login('alice@example.com');
    const bad = await request(app).post('/api/documents/import').set(alice).attach('file', Buffer.from('x'), 'evil.exe').expect(415);
    assert.match(bad.body.error, /Unsupported file type/);
    await request(app).post('/api/documents/import').set(alice).expect(400);
  });
});
