import { Types } from 'mongoose';
import { assertDevelopmentDatabase, DEFAULT_MONGODB_URI } from './config.js';
import { connectDatabase } from './database.js';
import { getTicketModel } from './ticket.js';

if (process.env.NODE_ENV === 'production') throw new Error('Production seeding is disabled.');
const connection = await connectDatabase(process.env.MONGODB_URI ?? DEFAULT_MONGODB_URI);
try {
  assertDevelopmentDatabase(connection.name, process.env.NODE_ENV ?? 'development');
  const TicketModel = getTicketModel(connection);
  await TicketModel.createIndexes();
  const tickets = [
    { title: 'Keep the dashboard current after a ticket changes', description: 'Refresh the list and summary after create, update and delete.', status: 'open', priority: 'high', tags: ['frontend', 'data'] },
    { title: 'Review a slow ticket query', description: 'Compare a filtered query with its supporting compound index using explain().', status: 'in_progress', priority: 'medium', tags: ['mongodb', 'performance'] },
    { title: 'Validate every update on the server', description: 'Reject unknown fields, operators and values outside the status and priority enums.', status: 'resolved', priority: 'high', tags: ['api', 'validation'] },
    { title: 'Add empty and error states', description: 'Keep a helpful interface when the database is empty or unavailable.', status: 'open', priority: 'low', tags: ['frontend'] },
    { title: 'Protect write endpoints', description: 'Use an explicit API key; production mutations fail closed without configuration.', status: 'resolved', priority: 'medium', tags: ['api', 'security'] },
    { title: 'Document a reproducible local setup', description: 'Start a local MongoDB container, create indexes and run integration tests.', status: 'in_progress', priority: 'low', tags: ['docs', 'mongodb'] },
  ];
  let inserted = 0;
  for (const [index, ticket] of tickets.entries()) {
    const _id = new Types.ObjectId(`10000000000000000000000${index + 1}`);
    const createdAt = new Date(Date.UTC(2026, 9, 25 + index, 10));
    const result = await TicketModel.updateOne({ _id }, { $setOnInsert: { ...ticket, createdAt, updatedAt: createdAt } }, {
      upsert: true, runValidators: true, setDefaultsOnInsert: true, timestamps: false,
    });
    inserted += result.upsertedCount;
  }
  console.log(`Development seed complete: ${inserted} inserted; ${tickets.length - inserted} already present.`);
} finally { await connection.close(); }
