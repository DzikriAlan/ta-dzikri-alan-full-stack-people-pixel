import { loadEnvFile } from '../../src/utils/load-env.js';

loadEnvFile();

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Copy .env.example to .env and point it at a throwaway ' +
      'database -- the test suite truncates the mentions table.',
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
