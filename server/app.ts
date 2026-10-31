import express, { type ErrorRequestHandler, type Request, type Response, type NextFunction } from 'express';
import mongoose, { type Connection } from 'mongoose';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getWriteKey } from './config.js';
import { getTicketModel, PRIORITIES, STATUSES } from './ticket.js';

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

interface AppOptions {
  connection: Connection;
  environment?: string;
  writeApiKey?: string;
  webDirectory?: string;
}

const fields = new Set(['title', 'description', 'status', 'priority', 'tags']);
function ticketBody(value: unknown, partial: boolean): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'A JSON object is required.');
  }
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.some(key => !fields.has(key))) throw new ApiError(400, 'Unknown ticket field.');
  if (partial && keys.length === 0) throw new ApiError(400, 'Provide at least one ticket field.');
  if (!partial && typeof body.title !== 'string') throw new ApiError(400, 'Title is required.');
  for (const key of keys) {
    if (key === 'tags') {
      if (!Array.isArray(body.tags) || body.tags.some(tag => typeof tag !== 'string')) {
        throw new ApiError(400, 'Tags must be an array of strings.');
      }
    } else if (typeof body[key] !== 'string') {
      throw new ApiError(400, `${key} must be a string.`);
    }
  }
  return body;
}

function validId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw new ApiError(400, 'Ticket ID must be a valid ObjectId.');
}

function integerQuery(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new ApiError(400, `${field} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new ApiError(400, `${field} must be at most ${maximum}.`);
  }
  return parsed;
}

export function createApp(options: AppOptions) {
  const app = express();
  const environment = options.environment ?? process.env.NODE_ENV ?? 'development';
  const key = getWriteKey(environment, options.writeApiKey ?? process.env.WRITE_API_KEY);
  const TicketModel = getTicketModel(options.connection);
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  function writeAccess(req: Request, _res: Response, next: NextFunction) {
    if (!key) return next(new ApiError(503, 'Write access is not configured.'));
    const supplied = req.get('X-API-Key');
    if (!supplied || Buffer.byteLength(supplied) !== Buffer.byteLength(key) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(key))) {
      return next(new ApiError(401, 'A valid X-API-Key is required.'));
    }
    next();
  }

  app.get('/api/health', async (_req, res) => {
    if (options.connection.readyState !== 1 || !options.connection.db) {
      throw new ApiError(503, 'Database is unavailable.');
    }
    try { await options.connection.db.command({ ping: 1 }); }
    catch { throw new ApiError(503, 'Database is unavailable.'); }
    res.json({ status: 'ok', database: 'connected' });
  });

  app.get('/api/tickets', async (req, res) => {
    const allowed = new Set(['status', 'priority', 'page', 'limit']);
    if (Object.keys(req.query).some(field => !allowed.has(field))) {
      throw new ApiError(400, 'Unknown ticket query parameter.');
    }
    const filter: { status?: typeof STATUSES[number]; priority?: typeof PRIORITIES[number] } = {};
    for (const [field, choices] of [['status', STATUSES], ['priority', PRIORITIES]] as const) {
      const value = req.query[field];
      if (value !== undefined) {
        if (typeof value !== 'string' || !(choices as readonly string[]).includes(value)) {
          throw new ApiError(400, `Invalid ${field} filter.`);
        }
        if (field === 'status') filter.status = value as typeof STATUSES[number];
        else filter.priority = value as typeof PRIORITIES[number];
      }
    }
    const page = integerQuery(req.query.page, 1, 10000, 'page');
    const limit = integerQuery(req.query.limit, 20, 50, 'limit');
    const [items, total] = await Promise.all([
      TicketModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      TicketModel.countDocuments(filter),
    ]);
    res.json({ items, total, page, limit });
  });

  app.post('/api/tickets', writeAccess, async (req, res) => {
    const item = await TicketModel.create(ticketBody(req.body, false));
    res.status(201).json({ item });
  });

  app.get('/api/tickets/:id', async (req, res) => {
    validId(req.params.id);
    const item = await TicketModel.findById(req.params.id).lean();
    if (!item) throw new ApiError(404, 'Ticket not found.');
    res.json({ item });
  });

  app.patch('/api/tickets/:id', writeAccess, async (req, res) => {
    validId(req.params.id);
    const body = ticketBody(req.body, true);
    const item = await TicketModel.findByIdAndUpdate(req.params.id, { $set: body }, {
      returnDocument: 'after', runValidators: true,
    }).lean();
    if (!item) throw new ApiError(404, 'Ticket not found.');
    res.json({ item });
  });

  app.delete('/api/tickets/:id', writeAccess, async (req, res) => {
    validId(req.params.id);
    const item = await TicketModel.findByIdAndDelete(req.params.id);
    if (!item) throw new ApiError(404, 'Ticket not found.');
    res.status(204).end();
  });

  app.get('/api/reports/summary', async (_req, res) => {
    const [summary] = await TicketModel.aggregate<{
      total: { count: number }[];
      status: { _id: string; count: number }[];
      priority: { _id: string; count: number }[];
    }>([{ $facet: {
      total: [{ $count: 'count' }],
      status: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
      priority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
    } }]);
    const byStatus = { open: 0, in_progress: 0, resolved: 0 };
    const byPriority = { low: 0, medium: 0, high: 0 };
    for (const row of summary?.status ?? []) {
      if (STATUSES.includes(row._id as typeof STATUSES[number])) byStatus[row._id as keyof typeof byStatus] = row.count;
    }
    for (const row of summary?.priority ?? []) {
      if (PRIORITIES.includes(row._id as typeof PRIORITIES[number])) byPriority[row._id as keyof typeof byPriority] = row.count;
    }
    res.json({ total: summary?.total[0]?.count ?? 0, byStatus, byPriority });
  });

  // Unknown API routes remain JSON errors, never the web application's HTML.
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'API route not found.')));
  if (environment === 'production') {
    const webDirectory = resolve(options.webDirectory ?? 'dist/web');
    if (existsSync(resolve(webDirectory, 'index.html'))) {
      app.use(express.static(webDirectory));
      app.get('/{*path}', (_req, res) => res.sendFile(resolve(webDirectory, 'index.html')));
    }
  }
  app.use((_req, _res, next) => next(new ApiError(404, 'Route not found.')));
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof ApiError) return void res.status(error.status).json({ error: { message: error.message } });
    if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError ||
      error instanceof mongoose.Error.StrictModeError) {
      const message = error instanceof mongoose.Error.ValidationError
        ? Object.values(error.errors).map(value => value.message).join(' ')
        : 'Invalid ticket data.';
      return void res.status(400).json({ error: { message } });
    }
    if (typeof error === 'object' && error !== null && 'type' in error) {
      if (error.type === 'entity.too.large') return void res.status(413).json({ error: { message: 'Request body is too large.' } });
      if (error.type === 'entity.parse.failed') return void res.status(400).json({ error: { message: 'Invalid JSON body.' } });
    }
    console.error('Unhandled API error:', error instanceof Error ? error.name : 'UnknownError');
    res.status(500).json({ error: { message: 'An unexpected server error occurred.' } });
  };
  app.use(errorHandler);
  return app;
}
