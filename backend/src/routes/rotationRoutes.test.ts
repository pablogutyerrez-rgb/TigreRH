import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { dataDb } from '../hybridDb.js';

test('Rotation routes preserve authentication, module access and read-only permissions', async (t) => {
  const firebase = initializeApp({ projectId: 'rotation-isolated-tests' });
  t.after(() => deleteApp(firebase));
  t.mock.method(getAuth(), 'verifyIdToken', async (token: string) => ({ uid: token }) as any);
  const profiles: Record<string, Record<string, unknown>> = {
    admin: { rol: 'Administrador' },
    denied: { rol: 'Formador' },
    reader: { rol: 'Formador', module_access: ['formacion:rotacion'], module_view_only: ['formacion:rotacion'] },
    writer: { rol: 'Formador', module_access: ['formacion:rotacion'] },
  };
  t.mock.method(dataDb, 'collection', (name: string): any => ({
    doc: (id: string) => ({ id, get: async () => ({ exists: Boolean(profiles[id]), data: () => ({ estado: 'Activo', ...profiles[id] }) }) }),
    get: async () => ({ docs: [] }),
  }));
  let writes = 0;
  t.mock.method(dataDb, 'runTransaction', async (callback: any) => callback({ get: async () => ({ exists: false }), set: () => { writes++; } }));
  const { rotationRoutes } = await import('./rotationRoutes.js');
  const app = express(); app.use(express.json()); app.use('/rotation', rotationRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address() as { port: number };
  const request = (token: string, path = '', method = 'GET', rows?: unknown[]) => fetch(`http://127.0.0.1:${address.port}/rotation${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(rows ? { body: JSON.stringify({ rows }) } : {}) });
  assert.equal((await request('')).status, 401);
  assert.equal((await request('denied')).status, 403);
  for (const token of ['admin', 'reader', 'writer']) assert.equal((await request(token)).status, 200);
  const rows = [{ DNI: '00130365', CESE: '20/10/2026', MOTIVO: 'Renuncia' }];
  assert.equal((await request('reader', '/bajas', 'POST', rows)).status, 403); assert.equal(writes, 0);
  assert.equal((await request('denied', '/bajas', 'POST', rows)).status, 403); assert.equal(writes, 0);
  for (const token of ['admin', 'writer']) assert.equal((await request(token, '/bajas', 'POST', rows)).status, 201);
  for (const query of ['?months=2026-13', '?from=2026-02-31', '?from=2026-10-22&to=2026-10-01']) assert.equal((await request('admin', query)).status, 400);
  assert.equal((await request('admin', '/bajas', 'POST', [{ DNI: '1', CESE: '31/02/2026' }])).status, 400);
});
