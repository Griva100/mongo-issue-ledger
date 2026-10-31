import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose, { type Connection } from 'mongoose';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { connectDatabase } from '../server/database.js';
import { assertDevelopmentDatabase } from '../server/config.js';
import { getTicketModel } from '../server/ticket.js';

const uri = process.env.TEST_MONGODB_URI;
if (!uri) throw new Error('Set TEST_MONGODB_URI to a real, isolated issue_ledger_test MongoDB database.');
// Both pre-connect and post-connect guards prevent cleanup against any development/production DB.
if (decodeURIComponent(new URL(uri).pathname) !== '/issue_ledger_test') {
  throw new Error('Integration tests may use only the issue_ledger_test database.');
}
if (process.env.NODE_ENV === 'production') throw new Error('Do not run integration tests in production.');

let connection: Connection;
let app: ReturnType<typeof createApp>;
let TicketModel: ReturnType<typeof getTicketModel>;
const key = 'integration-test-key';

beforeAll(async () => {
  connection = await connectDatabase(uri);
  if (connection.name !== 'issue_ledger_test') throw new Error('Refusing test cleanup outside issue_ledger_test.');
  TicketModel = getTicketModel(connection);
  await TicketModel.createIndexes();
  app = createApp({ connection, environment: 'test', writeApiKey: key });
}, 15000);

beforeEach(async () => {
  if (connection.name !== 'issue_ledger_test') throw new Error('Unsafe test database.');
  await TicketModel.deleteMany({});
});

afterAll(async () => {
  if (connection?.name === 'issue_ledger_test') await TicketModel.deleteMany({});
  await connection?.close();
});

describe('real MongoDB API', () => {
  it('persists a full CRUD lifecycle, applies defaults and keeps timestamps', async () => {
    const created = await request(app).post('/api/tickets').set('X-API-Key', key)
      .send({ title: '  Investigate latency  ', tags: [' API ', 'MongoDB'] }).expect(201);
    const item = created.body.item;
    expect(item).toMatchObject({ title: 'Investigate latency', description: '', status: 'open', priority: 'medium', tags: ['api', 'mongodb'] });
    expect(item._id).toMatch(/^[a-f0-9]{24}$/);
    expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);
    expect(item).not.toHaveProperty('__v');
    expect(await TicketModel.countDocuments({ _id: item._id })).toBe(1);

    const loaded = await request(app).get(`/api/tickets/${item._id}`).expect(200);
    expect(loaded.body.item).toEqual(item);
    const changed = await request(app).patch(`/api/tickets/${item._id}`).set('X-API-Key', key)
      .send({ status: 'in_progress', priority: 'high', description: 'Review the query plan.' }).expect(200);
    expect(changed.body.item).toMatchObject({ title: item.title, status: 'in_progress', priority: 'high', description: 'Review the query plan.', createdAt: item.createdAt });
    expect(Date.parse(changed.body.item.updatedAt)).toBeGreaterThanOrEqual(Date.parse(item.updatedAt));
    expect((await TicketModel.findById(item._id))?.status).toBe('in_progress');
    await request(app).delete(`/api/tickets/${item._id}`).set('X-API-Key', key).expect(204);
    await request(app).get(`/api/tickets/${item._id}`).expect(404);
    expect(await TicketModel.countDocuments()).toBe(0);
  });

  it('allows public reads and requires the API key for every mutation', async () => {
    await request(app).get('/api/tickets').expect(200);
    await request(app).get('/api/reports/summary').expect(200);
    await request(app).post('/api/tickets').send({ title: 'Unauthorised' }).expect(401);
    await request(app).post('/api/tickets').set('X-API-Key', 'wrong').send({ title: 'Wrong key' }).expect(401);
    const item = await TicketModel.create({ title: 'Protected' });
    await request(app).patch(`/api/tickets/${item._id}`).send({ status: 'resolved' }).expect(401);
    await request(app).delete(`/api/tickets/${item._id}`).expect(401);
    expect(await TicketModel.countDocuments()).toBe(1);
  });

  it('fails closed in production without a write key, while keeping reads available', async () => {
    const production = createApp({ connection, environment: 'production', writeApiKey: '' });
    await request(production).get('/api/tickets').expect(200);
    for (const supplied of ['', 'dev-only-key']) {
      const response = await request(production).post('/api/tickets').set('X-API-Key', supplied).send({ title: 'Denied' }).expect(503);
      expect(response.body).toEqual({ error: { message: 'Write access is not configured.' } });
    }
    const configured = createApp({ connection, environment: 'production', writeApiKey: key });
    await request(configured).post('/api/tickets').set('X-API-Key', key).send({ title: 'Configured' }).expect(201);
  });

  it('permits the explicit local development key only in development', async () => {
    const development = createApp({ connection, environment: 'development', writeApiKey: '' });
    await request(development).post('/api/tickets').set('X-API-Key', 'dev-only-key').send({ title: 'Local demo' }).expect(201);
  });

  it.each([
    {}, { title: '' }, { title: '   ' }, { title: 'x'.repeat(141) },
    { title: 'Valid', description: 'x'.repeat(3001) },
    { title: 'Valid', status: 'closed' }, { title: 'Valid', priority: 'urgent' },
    { title: 'Valid', tags: [''] }, { title: 'Valid', tags: ['x'.repeat(33)] },
    { title: 'Valid', tags: Array.from({ length: 9 }, (_, i) => String(i)) },
    { title: 'Valid', tags: ['API', ' api '] }, { title: 'Valid', tags: [1] },
    { title: 'Valid', tags: 'api' }, { title: 1 }, { title: null },
    { title: 'Valid', unknown: true }, { title: { $ne: '' } },
    { title: 'Valid', status: { $ne: 'open' } },
  ])('rejects invalid create payload %# without writing a document', async body => {
    const response = await request(app).post('/api/tickets').set('X-API-Key', key).send(body).expect(400);
    expect(response.body.error.message).toEqual(expect.any(String));
    expect(await TicketModel.countDocuments()).toBe(0);
  });

  it('rejects operators, immutable/unknown fields, empty patches and invalid updates', async () => {
    const item = await TicketModel.create({ title: 'Keep me' });
    for (const body of [
      {}, { $set: { status: 'resolved' } }, { $inc: { priority: 1 } },
      { title: { $gt: '' } }, { _id: new mongoose.Types.ObjectId().toString() },
      { createdAt: '2020-01-01' }, { status: 'invalid' }, { title: '' }, { tags: ['duplicate', 'duplicate'] },
    ]) {
      await request(app).patch(`/api/tickets/${item._id}`).set('X-API-Key', key).send(body).expect(400);
    }
    await request(app).post('/api/tickets').set('X-API-Key', key).set('Content-Type', 'application/json')
      .send('{"title":"test","__proto__":{"polluted":true}}').expect(400);
    expect((await TicketModel.findById(item._id))?.title).toBe('Keep me');
    expect(await TicketModel.countDocuments()).toBe(1);
    expect({}).not.toHaveProperty('polluted');
  });

  it('rejects malformed JSON, array bodies and oversized requests', async () => {
    await request(app).post('/api/tickets').set('X-API-Key', key).set('Content-Type', 'application/json').send('{bad').expect(400);
    await request(app).post('/api/tickets').set('X-API-Key', key).send([{ title: 'not an object' }]).expect(400);
    await request(app).post('/api/tickets').set('X-API-Key', key).send({ title: 'Large', description: 'x'.repeat(20000) }).expect(413);
    expect(await TicketModel.countDocuments()).toBe(0);
  });

  it('distinguishes malformed IDs, missing documents and unknown API routes', async () => {
    const missing = new mongoose.Types.ObjectId().toString();
    for (const id of ['not-an-id', 'abcdefghijkl', 'z'.repeat(24)]) {
      await request(app).get(`/api/tickets/${id}`).expect(400);
      await request(app).patch(`/api/tickets/${id}`).set('X-API-Key', key).send({ status: 'resolved' }).expect(400);
      await request(app).delete(`/api/tickets/${id}`).set('X-API-Key', key).expect(400);
    }
    await request(app).get(`/api/tickets/${missing}`).expect(404);
    await request(app).patch(`/api/tickets/${missing}`).set('X-API-Key', key).send({ status: 'resolved' }).expect(404);
    await request(app).delete(`/api/tickets/${missing}`).set('X-API-Key', key).expect(404);
    const response = await request(app).get('/api/does-not-exist').expect(404);
    expect(response.body).toEqual({ error: { message: 'API route not found.' } });
  });

  it('filters, paginates, sorts newest first, and counts the filtered collection', async () => {
    const values = [
      { title: 'Old open high', status: 'open', priority: 'high' },
      { title: 'Resolved', status: 'resolved', priority: 'low' },
      { title: 'Open medium', status: 'open', priority: 'medium' },
      { title: 'Progress high', status: 'in_progress', priority: 'high' },
      { title: 'New open high', status: 'open', priority: 'high' },
    ];
    await TicketModel.insertMany(values.map((value, i) => ({ ...value, createdAt: new Date(2026, 0, i + 1) })));
    const first = await request(app).get('/api/tickets?limit=2').expect(200);
    expect(first.body).toMatchObject({ total: 5, page: 1, limit: 2 });
    expect(first.body.items.map((item: { title: string }) => item.title)).toEqual(['New open high', 'Progress high']);
    const second = await request(app).get('/api/tickets?limit=2&page=2').expect(200);
    expect(second.body.items.map((item: { title: string }) => item.title)).toEqual(['Open medium', 'Resolved']);
    const filtered = await request(app).get('/api/tickets?status=open&priority=high&limit=1&page=2').expect(200);
    expect(filtered.body).toMatchObject({ total: 2, page: 2, limit: 1 });
    expect(filtered.body.items[0].title).toBe('Old open high');
    expect((await request(app).get('/api/tickets?priority=low')).body.total).toBe(1);
    expect((await request(app).get('/api/tickets?status=open')).body.total).toBe(3);
    expect((await request(app).get('/api/tickets?page=10000')).body.items).toEqual([]);
  });

  it.each([
    'status=invalid', 'priority=urgent', 'page=0', 'page=-1', 'page=1.5', 'page=1e2',
    'page=10001', 'page=999999999999999999999', 'limit=0', 'limit=51',
    'status=open&status=resolved', 'status[$ne]=resolved', 'priority[$gt]=low',
    '$where=1', 'sort=title', 'page[skip]=1',
  ])('rejects invalid or operator query %s', async query => {
    const response = await request(app).get(`/api/tickets?${query}`).expect(400);
    expect(response.body.error.message).toEqual(expect.any(String));
  });

  it('aggregates empty and populated status/priority totals directly in MongoDB', async () => {
    const empty = { total: 0, byStatus: { open: 0, in_progress: 0, resolved: 0 }, byPriority: { low: 0, medium: 0, high: 0 } };
    expect((await request(app).get('/api/reports/summary').expect(200)).body).toEqual(empty);
    const rows = await TicketModel.create([
      { title: 'A', status: 'open', priority: 'high' },
      { title: 'B', status: 'open', priority: 'low' },
      { title: 'C', status: 'resolved', priority: 'high' },
      { title: 'D', status: 'in_progress', priority: 'medium' },
    ]);
    expect((await request(app).get('/api/reports/summary')).body).toEqual({ total: 4, byStatus: { open: 2, in_progress: 1, resolved: 1 }, byPriority: { low: 1, medium: 1, high: 2 } });
    await request(app).patch(`/api/tickets/${rows[0]!._id}`).set('X-API-Key', key).send({ status: 'resolved', priority: 'low' }).expect(200);
    await request(app).delete(`/api/tickets/${rows[1]!._id}`).set('X-API-Key', key).expect(204);
    expect((await request(app).get('/api/reports/summary')).body).toEqual({ total: 3, byStatus: { open: 0, in_progress: 1, resolved: 2 }, byPriority: { low: 1, medium: 1, high: 1 } });
  });

  it('creates the explicit compound indexes in the actual database', async () => {
    const indexes = await TicketModel.collection.indexes();
    const expected = {
      tickets_newest: { createdAt: -1, _id: -1 },
      tickets_status_newest: { status: 1, createdAt: -1, _id: -1 },
      tickets_priority_newest: { priority: 1, createdAt: -1, _id: -1 },
      tickets_status_priority_newest: { status: 1, priority: 1, createdAt: -1, _id: -1 },
    };
    for (const [name, keys] of Object.entries(expected)) expect(indexes.find(index => index.name === name)?.key).toEqual(keys);
    await TicketModel.create({ title: 'Query plan', status: 'open', priority: 'high' });
    const plan = await TicketModel.collection.find({ status: 'open', priority: 'high' }).sort({ createdAt: -1, _id: -1 })
      .hint('tickets_status_priority_newest').explain('executionStats');
    expect(plan.executionStats.nReturned).toBe(1);
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain('tickets_status_priority_newest');
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).not.toContain('"stage":"SORT"');
  });

  it('reports real database connectivity and protects non-test databases from seed operations', async () => {
    expect((await request(app).get('/api/health').expect(200)).body).toEqual({ status: 'ok', database: 'connected' });
    const disconnected = mongoose.createConnection();
    try {
      await request(createApp({ connection: disconnected, environment: 'test', writeApiKey: key })).get('/api/health').expect(503);
    } finally { await disconnected.close(); }
    expect(() => assertDevelopmentDatabase('issue_ledger_dev', 'development')).not.toThrow();
    for (const database of ['production', 'issue_ledger_test', 'other_dev']) {
      expect(() => assertDevelopmentDatabase(database, 'development')).toThrow();
    }
    expect(() => assertDevelopmentDatabase('issue_ledger_dev', 'production')).toThrow();
  });

  it('serves built web assets in production and keeps missing API routes as JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'issue-ledger-web-'));
    try {
      await writeFile(join(directory, 'index.html'), '<!doctype html><title>Issue Ledger</title>');
      const production = createApp({ connection, environment: 'production', writeApiKey: key, webDirectory: directory });
      const page = await request(production).get('/').expect(200);
      expect(page.type).toBe('text/html');
      expect(page.text).toContain('Issue Ledger');
      const missing = await request(production).get('/api/missing').expect(404);
      expect(missing.type).toBe('application/json');
      expect(missing.body.error.message).toBe('API route not found.');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
