import { DEFAULT_MONGODB_URI } from './config.js';
import { connectDatabase } from './database.js';
import { getTicketModel } from './ticket.js';

if (process.env.NODE_ENV === 'production' && !process.env.MONGODB_URI) throw new Error('MONGODB_URI is required in production.');
const connection = await connectDatabase(process.env.MONGODB_URI ?? DEFAULT_MONGODB_URI);
try {
  const TicketModel = getTicketModel(connection);
  await TicketModel.createIndexes();
  console.log(JSON.stringify(await TicketModel.collection.indexes(), null, 2));
} finally { await connection.close(); }
