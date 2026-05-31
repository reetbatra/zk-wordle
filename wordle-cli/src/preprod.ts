// SPDX-License-Identifier: Apache-2.0
//
// Entry point: load .env, build the preprod config, create a logger, and
// start the Wordle game loop.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from './logger-utils.js';
import { loadConfig } from './config.js';
import { run } from './game.js';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '..', '..', '.env'));
} catch {
  // No .env file present — fall back to real environment variables / defaults.
}

const config = loadConfig();
const logger = await createLogger(config.logDir);
await run(config, logger);
