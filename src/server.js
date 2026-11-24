import { open, USERS } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3007);
const dbPath = process.env.DB_PATH || 'data/leetkob.db';
const server = createApp(open(dbPath)).listen(port, () => {
  console.log(`LeeTKOB server on http://localhost:${port} (db: ${dbPath})`);
  console.log('tokens:  ' + USERS.map((u) => `${u.name}=${u.token}`).join('  '));
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
