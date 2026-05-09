import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function setup() {
  // Pre-create coverage/.tmp so node-environment workers can write their coverage
  // data without a race condition against the main vitest process.
  const tmpDir = join(process.cwd(), 'coverage', '.tmp');
  mkdirSync(tmpDir, { recursive: true });
}
