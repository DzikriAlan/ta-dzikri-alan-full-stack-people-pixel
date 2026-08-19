import pg from 'pg';

const { Pool, types } = pg;

types.setTypeParser(types.builtins.INT8, (value) => Number.parseInt(value, 10));

export type Database = pg.Pool;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string): Database {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}
