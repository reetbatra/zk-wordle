// SPDX-License-Identifier: Apache-2.0
//
// zk-wordle game loop. The host's CLI picks a secret word, commits a hash of
// it on chain (newGame), and then proves the Wordle clue for each guess via a
// ZK circuit — the word and salt never leave this process.
import { stdin as input, stdout as output } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { type Logger } from 'pino';
import { Wordle, createWordlePrivateState, type WordlePrivateState } from '@zk-wordle/contract';
import * as api from './api.js';
import { type Config } from './config.js';
import { type WordleProviders, type DeployedWordleContract } from './common-types.js';
import { pickRandomWord } from './words.js';

let logger: Logger;

const MAX_ATTEMPTS = 6;

// ─── ANSI rendering ──────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIVIDER = '──────────────────────────────────────────────────────────────';

const BANNER = `
╔══════════════════════════════════════════════════════════════╗
║                                                                ║
║                       z k - W O R D L E                        ║
║          A privacy-preserving Wordle on Midnight               ║
║                                                                ║
║   The secret word is committed as a hash. Every clue is a      ║
║   zero-knowledge proof — the word itself is never revealed.    ║
║                                                                ║
╚══════════════════════════════════════════════════════════════╝`;

/** Render one guess row as colored tiles. clue: 1=green, 2=yellow, 0=gray. */
const renderRow = (guess: number[], clue: number[]): string =>
  guess
    .map((code, i) => {
      const ch = ` ${String.fromCharCode(code).toUpperCase()} `;
      switch (clue[i]) {
        case 1:
          return `\x1b[42m\x1b[30m${BOLD}${ch}${RESET}`; // green bg, black fg
        case 2:
          return `\x1b[43m\x1b[30m${BOLD}${ch}${RESET}`; // yellow bg, black fg
        default:
          return `\x1b[100m\x1b[97m${BOLD}${ch}${RESET}`; // gray bg, white fg
      }
    })
    .join(' ');

const renderBoard = (view: api.GameView): void => {
  console.log('');
  for (const row of view.rows) {
    console.log(`  ${renderRow(row.guess, row.clue)}`);
  }
  const remaining = MAX_ATTEMPTS - view.attempts;
  if (view.status === Wordle.GameStatus.Playing && remaining > 0) {
    console.log(`\n  ${remaining} guess${remaining === 1 ? '' : 'es'} remaining.`);
  }
  console.log('');
};

// ─── Input helpers ───────────────────────────────────────────────────────────

const isValidGuess = (s: string): boolean => /^[a-z]{5}$/.test(s);

const toLetterCodes = (word: string): bigint[] =>
  Array.from(word.toLowerCase(), (c) => BigInt(c.charCodeAt(0)));

/** Prompt until the user enters a valid 5-letter guess (or types :quit). */
const promptGuess = async (rli: Interface): Promise<string | null> => {
  while (true) {
    const raw = (await rli.question('  Guess (5 letters, or :quit): ')).trim().toLowerCase();
    if (raw === ':quit' || raw === ':q') return null;
    if (isValidGuess(raw)) return raw;
    console.log('  ✗ Please enter exactly 5 letters (a-z).');
  }
};

// ─── Game flows ──────────────────────────────────────────────────────────────

/** Play out the guess loop against a deployed contract until won/lost/quit. */
const playLoop = async (
  providers: WordleProviders,
  contract: DeployedWordleContract,
  rli: Interface,
  secretWord: string | null,
): Promise<void> => {
  const address = contract.deployTxData.public.contractAddress;

  while (true) {
    const view = await api.readGameState(providers, address);
    if (view == null) {
      console.log('  ✗ Could not read game state from the indexer.');
      return;
    }
    renderBoard(view);

    if (view.status === Wordle.GameStatus.Won) {
      console.log(`  🎉 ${BOLD}Solved in ${view.attempts}!${RESET}\n`);
      return;
    }
    if (view.status === Wordle.GameStatus.Lost) {
      const reveal = secretWord ? ` The word was ${BOLD}${secretWord.toUpperCase()}${RESET}.` : '';
      console.log(`  ✗ Out of guesses.${reveal}\n`);
      return;
    }
    if (view.attempts >= MAX_ATTEMPTS) {
      return;
    }

    const guess = await promptGuess(rli);
    if (guess === null) {
      console.log('  Game paused. You can resume later with the contract address above.\n');
      return;
    }

    try {
      await api.withStatus('Proving + submitting guess', () => api.submitGuess(contract, toLetterCodes(guess)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ✗ Guess failed: ${msg}\n`);
      if (msg.toLowerCase().includes('dust')) {
        console.log('    Insufficient DUST for fees — wait for more to generate, then retry.\n');
      }
    }
  }
};

/** Start a brand-new game: pick a word, deploy, and commit it on chain. */
const startNewGame = async (providers: WordleProviders, rli: Interface): Promise<void> => {
  const word = pickRandomWord();
  const salt = randomBytes(32);
  const privateState: WordlePrivateState = createWordlePrivateState(word, salt);

  console.log(`\n  A secret word has been chosen and will be committed on chain.`);
  console.log(`  (It stays private — only its hash is published.)\n`);

  const contract = await api.withStatus('Deploying contract', () => api.deploy(providers, privateState));
  await api.withStatus('Committing secret word (newGame)', () => api.newGame(contract));

  const address = contract.deployTxData.public.contractAddress;
  console.log(`\n  Game ready at contract address:\n  ${BOLD}${address}${RESET}\n`);

  await playLoop(providers, contract, rli, word);
};

/** Resume a game previously deployed from this machine (private state in store). */
const resumeGame = async (providers: WordleProviders, rli: Interface): Promise<void> => {
  const address = (await rli.question('  Enter the contract address (hex): ')).trim();
  if (address === '') {
    console.log('  ✗ No address entered.\n');
    return;
  }
  try {
    const contract = await api.withStatus('Joining contract', () => api.joinContract(providers, address));
    await playLoop(providers, contract, rli, null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ✗ Could not resume: ${msg}`);
    console.log('    Resuming requires the original secret word in this machine\'s local store.\n');
  }
};

const MENU = `
${DIVIDER}
  [1] Start a new game
  [2] Resume a game by contract address
  [3] Exit
${DIVIDER}
> `;

// ─── Entry ───────────────────────────────────────────────────────────────────

/** Build/restore the wallet, then ask the user to create or restore one if no seed. */
const buildWallet = async (config: Config, rli: Interface): Promise<api.WalletContext> => {
  const envSeed = process.env.WALLET_SEED?.trim();
  if (envSeed) {
    return await api.buildWalletAndWaitForFunds(config, envSeed);
  }
  const seed = (await rli.question('  Enter your wallet seed (hex) or 24-word recovery phrase, or leave blank to generate a new one: ')).trim();
  return seed ? await api.buildWalletAndWaitForFunds(config, seed) : await api.buildFreshWallet(config);
};

export const run = async (config: Config, _logger: Logger): Promise<void> => {
  logger = _logger;
  api.setLogger(_logger);

  console.log(BANNER);

  const rli = createInterface({ input, output, terminal: true });
  let walletCtx: api.WalletContext | undefined;

  try {
    walletCtx = await buildWallet(config, rli);
    const providers = await api.withStatus('Configuring providers', () => api.configureProviders(walletCtx!, config));
    console.log('');

    while (true) {
      const choice = (await rli.question(MENU)).trim();
      if (choice === '1') {
        await startNewGame(providers, rli);
      } else if (choice === '2') {
        await resumeGame(providers, rli);
      } else if (choice === '3') {
        break;
      } else {
        console.log(`  Invalid choice: ${choice}`);
      }
    }
  } catch (e) {
    if (e instanceof Error) {
      logger.error(`Error: ${e.message}`);
      logger.debug(`${e.stack}`);
    } else {
      throw e;
    }
  } finally {
    if (walletCtx !== undefined) {
      try {
        await walletCtx.wallet.stop();
      } catch (e) {
        logger.error(`Error stopping wallet: ${e}`);
      }
    }
    rli.close();
    rli.removeAllListeners();
    logger.info('Goodbye.');
  }
};
