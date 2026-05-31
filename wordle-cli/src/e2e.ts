// SPDX-License-Identifier: Apache-2.0
//
// Non-interactive end-to-end run against Midnight preprod. Builds the wallet,
// deploys a fresh wordle contract, commits a known secret word, then plays a
// scripted sequence of guesses with REAL ZK proofs. After each guess it reads
// the on-chain clue back from the ledger and asserts it matches an independent
// TS re-implementation of the Wordle rule — i.e. it verifies the Compact
// circuit produced the correct feedback. Doubles as Task 8's e2e proof and a
// living integration test.
//
// Configure (optional):
//   E2E_WORD=crane                 # the secret word (host knows it)
//   E2E_GUESSES=slate,react,crane  # guesses; end with the word to win
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createWordlePrivateState, Wordle } from '@zk-wordle/contract';
import { createLogger } from './logger-utils.js';
import { loadConfig } from './config.js';
import { type WordleProviders } from './common-types.js';
import * as api from './api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '..', '..', '.env'));
} catch {
  /* fall back to real env vars */
}

// ─── Independent TS reference for the Wordle clue (mirrors wordle.compact) ────
// 1 = green, 2 = yellow, 0 = gray. Greens consume their slot first, then yellows
// claim the leftmost unused matching solution slot — same as computeClue/consumeOne.
const referenceClue = (guess: string, solution: string): number[] => {
  const g = [...guess];
  const s = [...solution];
  const clue = new Array<number>(5).fill(0);
  const taken = new Array<boolean>(5).fill(false);
  for (let i = 0; i < 5; i++) {
    if (g[i] === s[i]) {
      clue[i] = 1;
      taken[i] = true;
    }
  }
  for (let i = 0; i < 5; i++) {
    if (clue[i] === 1) continue;
    for (let j = 0; j < 5; j++) {
      if (!taken[j] && g[i] === s[j]) {
        clue[i] = 2;
        taken[j] = true;
        break;
      }
    }
  }
  return clue;
};

const toCodes = (w: string): bigint[] => Array.from(w.toLowerCase(), (c) => BigInt(c.charCodeAt(0)));

const RESET = '\x1b[0m';
const renderRow = (guess: number[], clue: number[]): string =>
  guess
    .map((code, i) => {
      const ch = ` ${String.fromCharCode(code).toUpperCase()} `;
      if (clue[i] === 1) return `\x1b[42m\x1b[30m${ch}${RESET}`;
      if (clue[i] === 2) return `\x1b[43m\x1b[30m${ch}${RESET}`;
      return `\x1b[100m\x1b[97m${ch}${RESET}`;
    })
    .join(' ');

const cleanGuessList = (raw: string | undefined, fallback: string[]): string[] =>
  (raw ? raw.split(',') : fallback).map((w) => w.trim().toLowerCase()).filter((w) => /^[a-z]{5}$/.test(w));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll the ledger until `attempts` reaches the expected value (indexer lag guard). */
const waitForAttempts = async (
  providers: WordleProviders,
  address: string,
  expected: number,
): Promise<api.GameView> => {
  for (let i = 0; i < 30; i++) {
    const view = await api.readGameState(providers, address);
    if (view && view.attempts >= expected) return view;
    await sleep(2000);
  }
  throw new Error(`Ledger did not reach ${expected} attempts in time`);
};

const main = async () => {
  const config = loadConfig();
  const logger = await createLogger(config.logDir);
  api.setLogger(logger);

  const seed = process.env.WALLET_SEED?.trim();
  if (!seed) {
    console.error('\n  ✗ WALLET_SEED is not set in .env.\n');
    process.exit(1);
  }

  const word = (process.env.E2E_WORD ?? 'crane').trim().toLowerCase();
  if (!/^[a-z]{5}$/.test(word)) throw new Error(`E2E_WORD must be 5 lowercase letters, got "${word}"`);
  const guesses = cleanGuessList(process.env.E2E_GUESSES, ['slate', 'react', word]);
  if (guesses.length === 0) throw new Error('No valid guesses');

  const DIV = '──────────────────────────────────────────────────────────────';
  console.log(`\n${DIV}\n  zk-wordle end-to-end on preprod\n${DIV}`);
  console.log(`  Secret word (host-only): ${word.toUpperCase()}`);
  console.log(`  Scripted guesses: ${guesses.map((g) => g.toUpperCase()).join(' → ')}\n`);

  const walletCtx = await api.buildWalletAndWaitForFunds(config, seed);
  let failures = 0;
  try {
    const providers = await api.withStatus('Configuring providers', () => api.configureProviders(walletCtx, config));

    const salt = randomBytes(32);
    const privateState = createWordlePrivateState(word, salt);
    const contract = await api.withStatus('Deploying contract', () => api.deploy(providers, privateState));
    await api.withStatus('Committing secret word (newGame)', () => api.newGame(contract));

    const address = contract.deployTxData.public.contractAddress;
    console.log(`\n  Contract: ${address}\n`);

    for (let n = 0; n < guesses.length; n++) {
      const guess = guesses[n];
      await api.withStatus(`Proving + submitting guess ${n + 1}/${guesses.length} (${guess.toUpperCase()})`, () =>
        api.submitGuess(contract, toCodes(guess)),
      );
      const view = await waitForAttempts(providers, address, n + 1);
      const row = view.rows[n];
      const expected = referenceClue(guess, word);

      console.log(`  ${renderRow(row.guess, row.clue)}`);
      const ok = row.clue.length === 5 && row.clue.every((c, i) => c === expected[i]);
      if (!ok) {
        failures++;
        console.log(`    ✗ clue mismatch — on-chain [${row.clue}] vs expected [${expected}]`);
      } else {
        console.log(`    ✓ on-chain clue matches the reference Wordle rule`);
      }

      if (view.status === Wordle.GameStatus.Won) {
        console.log(`\n  🎉 Solved in ${view.attempts} — status = Won (verified on chain).`);
        break;
      }
      if (view.status === Wordle.GameStatus.Lost) {
        console.log(`\n  Out of guesses — status = Lost.`);
        break;
      }
    }

    const finalView = await api.readGameState(providers, address);
    const lastGuessIsWord = guesses[Math.min(guesses.length, finalView!.attempts) - 1] === word;
    if (lastGuessIsWord && finalView!.status !== Wordle.GameStatus.Won) {
      failures++;
      console.log(`  ✗ expected status Won after guessing the word, got ${finalView!.status}`);
    }

    console.log(`\n${DIV}`);
    if (failures === 0) {
      console.log(`  ✓ END-TO-END PASS — real ZK proofs on preprod, every clue verified.`);
      console.log(`  Replay interactively: npm run play → [2] Resume → ${address}`);
      console.log(`${DIV}\n`);
    } else {
      console.log(`  ✗ END-TO-END FAILED — ${failures} check(s) did not pass.`);
      console.log(`${DIV}\n`);
    }
  } finally {
    try {
      await walletCtx.wallet.stop();
    } catch {
      /* ignore */
    }
  }
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error('\n  ✗ e2e run failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
