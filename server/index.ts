import { createApp } from './app.js';
import { DEFAULT_MONGODB_URI, getPort } from './config.js';
import { connectDatabase } from './database.js';
import { getTicketModel } from './ticket.js';

const environment = process.env.NODE_ENV ?? 'development';
if (environment === 'production' && !process.env.MONGODB_URI) {
  throw new Error('MONGODB_URI is required in production.');
}
const connection = await connectDatabase(process.env.MONGODB_URI ?? DEFAULT_MONGODB_URI);
await getTicketModel(connection).createIndexes();
const port = getPort();
const host = environment === 'production' ? '0.0.0.0' : '127.0.0.1';
const server = createApp({ connection, environment }).listen(port, host, () => {
  console.log(`Issue Ledger is listening on http://localhost:${port}`);
  if (environment === 'production' && !process.env.WRITE_API_KEY?.trim()) {
    console.warn('Write access is disabled: WRITE_API_KEY is not configured.');
  }
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(async () => { await connection.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
