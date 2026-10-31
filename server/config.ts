export const DEFAULT_MONGODB_URI = 'mongodb://127.0.0.1:27107/issue_ledger_dev';

export function getWriteKey(environment: string, configured?: string): string | undefined {
  const key = configured?.trim();
  return key || (environment === 'production' ? undefined : 'dev-only-key');
}

export function assertDevelopmentDatabase(database: string, environment: string): void {
  if (environment === 'production' || database !== 'issue_ledger_dev') {
    throw new Error('Seeding is allowed only for issue_ledger_dev outside production.');
  }
}

export function getPort(value = process.env.PORT): number {
  const port = value === undefined ? 3001 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return port;
}
