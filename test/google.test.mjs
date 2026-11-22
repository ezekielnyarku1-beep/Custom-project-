import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { OAuth2Client } from 'google-auth-library';
import { accountApi } from '../src/accounts.mjs';

test('Google login rejects unsafe email linking and accepts linked identities', async (t) => {
  const old = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  t.after(() => { if (old === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = old; });
  let payload = { sub: 'google-user', email: 'user@example.test', email_verified: true };
  t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => ({ getPayload: () => payload }));
  let linked = null;
  let sessions = 0;
  const db = { query: async (sql) => {
    if (sql.startsWith('SELECT id,google_sub')) return { rows: [{id: 'account', google_sub: linked}] };
    if (sql.startsWith('SELECT workspace_id')) return { rows: [{workspace_id: 'workspace'}] };
    if (sql.startsWith('INSERT INTO sessions')) sessions++;
    return { rows: [] };
  }};
  const req = {method: 'POST', body: {credential: 'test'}, socket: {}};
  await assert.rejects(accountApi(db, req, 'google'), {status: 409});
  assert.equal(sessions, 0);
  linked = 'other-google-user';
  payload.email = 'user@gmail.com';
  await assert.rejects(accountApi(db, req, 'google'), {status: 409});
  linked = 'google-user';
  assert.equal((await accountApi(db, req, 'google'))[0], 200);
  linked = null;
  assert.equal((await accountApi(db, req, 'google'))[0], 200);
  payload.email = 'user@company.test';
  payload.hd = 'company.test';
  assert.equal((await accountApi(db, req, 'google'))[0], 200);
  assert.equal(sessions, 3);
});

test('Google button uses server configuration and ignores detached auth pages', async () => {
  const source = await readFile(new URL('../client/app.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('async function initGoogleSignIn('), source.indexOf('function renderAuthContent('));
  let initialized, rendered;
  const container = {isConnected: true, clientWidth: 350, replaceChildren() {}};
  const google = {accounts: {id: {
    initialize(options) { initialized = options; },
    renderButton(target, options) { rendered = {target, options}; },
  }}};
  const context = vm.createContext({document: {getElementById: () => container}, window: {google}, google,
    request: async () => ({googleClientId: 'configured-client'})});
  vm.runInContext(code, context);
  await vm.runInContext('initGoogleSignIn("login")', context);
  assert.equal(initialized.client_id, 'configured-client');
  assert.equal(rendered.target, container);
  assert.equal(rendered.options.text, 'signin_with');
  initialized = null;
  container.isConnected = false;
  await vm.runInContext('initGoogleSignIn("signup")', context);
  assert.equal(initialized, null);
});
