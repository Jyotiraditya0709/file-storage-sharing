import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config.js';
import * as schema from './schema.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export const db = drizzle(pool, { schema });

export type Db = typeof db;

/** Anything that can run a query: the pool, or a transaction handle. */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
