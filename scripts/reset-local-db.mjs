// Deletes the local D1 database so `npm run db:reset` can start from scratch.
import { rmSync } from 'node:fs';
rmSync('.wrangler/state/v3/d1', { recursive: true, force: true });
console.log('Local database removed.');
