import { pool } from '../db/client.js';
import { run } from '../services/purge.service.js';

/**
 * Manual or scheduled purge: `node dist/scripts/purge.js`.
 * SPEC §4 deliberately leaves the scheduling to the operator.
 */
const report = await run();
console.log(JSON.stringify(report));
await pool.end();
