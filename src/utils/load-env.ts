import { existsSync } from 'node:fs';
import path from 'node:path';

export function loadEnvFile(cwd: string = process.cwd()): void {
  const envPath = path.resolve(cwd, '.env');
  if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  }
}
