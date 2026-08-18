import pg from 'pg';

const { Pool, types } = pg;

/**
 * `pg` returns BIGINT (OID 20) as a string to avoid precision loss. Every bigint
 * this service reads back is a COUNT or a row id that comfortably fits in a JS
 * number, so parsing here keeps `count` a number in JSON responses instead of a
 * string. Documented because it is a global, non-obvious driver override.
 */
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
