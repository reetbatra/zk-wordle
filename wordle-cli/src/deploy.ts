// SPDX-License-Identifier: Apache-2.0
//
// Non-interactive deploy: build the wallet from WALLET_SEED, deploy a fresh
// wordle contract, commit a random secret word (newGame), print the contract
// address, and exit. Play the deployed game with `npm run play` -> Resume.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createWordlePrivateState } from '@zk-wordle/contract';
import { createLogger } from './logger-utils.js';
import { loadConfig } from './config.js';
import { pickRandomWord } from './words.js';
import * as api from './api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '..', '..', '.env'));
} catch {
  // fall back to real env vars
}

const config = loadConfig();
const logger = await createLogger(config.logDir);
api.setLogger(logger);

const seed = process.env.WALLET_SEED?.trim();
if (!seed) {
  console.error('\n  ✗ WALLET_SEED is not set in .env — paste your 1AM hex seed first.\n');
  process.exit(1);
}

const walletCtx = await api.buildWalletAndWaitForFunds(config, seed);
try {
  const providers = await api.withStatus('Configuring providers', () => api.configureProviders(walletCtx, config));

  // Pick a secret word and commit it. The word stays private (only its hash is
  // published); it is NOT printed, so the game is blind for whoever plays.
  const word = pickRandomWord();
  const salt = randomBytes(32);
  const privateState = createWordlePrivateState(word, salt);

  const contract = await api.withStatus('Deploying contract', () => api.deploy(providers, privateState));
  await api.withStatus('Committing secret word (newGame)', () => api.newGame(contract));

  const address = contract.deployTxData.public.contractAddress;
  const DIV = '──────────────────────────────────────────────────────────────';
  console.log(`
${DIV}
  ✓ Game deployed and word committed on preprod.

  Contract address:
  ${address}

  Play it:  npm run play  ->  [2] Resume a game  ->  paste the address.
${DIV}
`);
} finally {
  try {
    await walletCtx.wallet.stop();
  } catch {
    /* ignore */
  }
}
process.exit(0);
