// SPDX-License-Identifier: Apache-2.0
//
// Wallet + provider plumbing and contract operations for zk-wordle.
//
// The wallet/provider setup (HD key derivation, three sub-wallets, dust
// registration, the unbound-transaction signing workaround) mirrors
// Midnight's example-counter, since it is generic midnight-js 4.x usage.
// The contract-specific parts are the compiled-contract definition and the
// deploy / newGame / submitGuess / ledger-read helpers.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { Wordle, witnesses, type WordlePrivateState } from '@zk-wordle/contract';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type FinalizedTxData, type MidnightProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js/types';
import { assertIsContractAddress, toHex } from '@midnight-ntwrk/midnight-js/utils';
import { getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { NoOpTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { type Logger } from 'pino';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import { Buffer } from 'buffer';
import { type WordleProviders, type DeployedWordleContract, WordlePrivateStateId } from './common-types.js';
import { type Config, contractConfig } from './config.js';
import { seedBytesFromInput, resolveDerivation } from './seed.js';
import {
  walletStatePath,
  loadWalletState,
  saveWalletState,
  clearWalletState,
  type WalletStateSnapshot,
} from './wallet-state.js';

let logger: Logger;

// Required for GraphQL subscriptions (wallet sync) to work in Node.js
// @ts-expect-error: needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

// Pre-compile the wordle contract with its ZK circuit assets. Unlike the
// counter example, wordle HAS witnesses (localSecretWord / localSalt), so we
// attach the real witness implementation rather than vacant witnesses.
const wordleCompiledContract = CompiledContract.make('wordle', Wordle.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

// ─── Contract operations ─────────────────────────────────────────────────────

export type GameRow = { guess: number[]; clue: number[] };
export interface GameView {
  status: Wordle.GameStatus;
  attempts: number;
  commitment: string;
  rows: GameRow[];
}

/** Read and decode the public ledger state of a deployed wordle contract. */
export const readGameState = async (
  providers: WordleProviders,
  contractAddress: ContractAddress,
): Promise<GameView | null> => {
  assertIsContractAddress(contractAddress);
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  if (contractState == null) {
    return null;
  }
  const lg = Wordle.ledger(contractState.data);
  const attempts = Number(lg.attempts);
  const rows: GameRow[] = [];
  for (let i = 0; i < attempts; i++) {
    rows.push({
      guess: lg.guesses.lookup(BigInt(i)).map(Number),
      clue: lg.clues.lookup(BigInt(i)).map(Number),
    });
  }
  return { status: lg.status, attempts, commitment: toHex(lg.commitment), rows };
};

/** Deploy a fresh wordle contract carrying the host's secret word + salt. */
export const deploy = async (
  providers: WordleProviders,
  privateState: WordlePrivateState,
): Promise<DeployedWordleContract> => {
  logger.info('Deploying wordle contract...');
  const contract = await deployContract(providers, {
    compiledContract: wordleCompiledContract,
    privateStateId: WordlePrivateStateId,
    initialPrivateState: privateState,
  });
  logger.info(`Deployed wordle contract at: ${contract.deployTxData.public.contractAddress}`);
  return contract;
};

/**
 * Join an already-deployed wordle contract (the host rejoining their own game).
 * If `privateState` is omitted, the word+salt are loaded from the local private
 * state store (only works on the machine that originally deployed the game).
 */
export const joinContract = async (
  providers: WordleProviders,
  contractAddress: string,
  privateState?: WordlePrivateState,
): Promise<DeployedWordleContract> => {
  const contract =
    privateState != null
      ? await findDeployedContract(providers, {
          contractAddress,
          compiledContract: wordleCompiledContract,
          privateStateId: WordlePrivateStateId,
          initialPrivateState: privateState,
        })
      : await findDeployedContract(providers, {
          contractAddress,
          compiledContract: wordleCompiledContract,
          privateStateId: WordlePrivateStateId,
        });
  logger.info(`Joined wordle contract at: ${contract.deployTxData.public.contractAddress}`);
  return contract;
};

/** Commit the secret word on chain (one-shot; moves status Empty -> Playing). */
export const newGame = async (contract: DeployedWordleContract): Promise<FinalizedTxData> => {
  logger.info('Committing secret word (newGame)...');
  const finalized = await contract.callTx.newGame();
  logger.info(`newGame tx ${finalized.public.txId} in block ${finalized.public.blockHeight}`);
  return finalized.public;
};

/** Submit a 5-letter guess (as ASCII codes). The clue is read from the ledger. */
export const submitGuess = async (
  contract: DeployedWordleContract,
  guess: bigint[],
): Promise<FinalizedTxData> => {
  const finalized = await contract.callTx.submitGuess(guess);
  logger.info(`submitGuess tx ${finalized.public.txId} in block ${finalized.public.blockHeight}`);
  return finalized.public;
};

// ─── Provider bridge (wallet-sdk-facade -> midnight-js) ──────────────────────

/**
 * Sign all unshielded offers in a transaction's intents, using the correct
 * proof marker for Intent.deserialize. Works around a wallet SDK bug where
 * signRecipe hardcodes 'pre-proof', which fails for proven (UnboundTransaction)
 * intents that contain 'proof' data.
 */
const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void => {
  if (!tx.intents || tx.intents.size === 0) return;

  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;

    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature',
      proofMarker,
      'pre-binding',
      intent.serialize(),
    );

    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);

    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }

    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }

    tx.intents.set(segment, cloned);
  }
};

const createWalletAndMidnightProvider = async (ctx: WalletContext): Promise<WalletProvider & MidnightProvider> => {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return {
    getCoinPublicKey() {
      return state.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return state.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx, ttl?) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
      signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
      if (recipe.balancingTransaction) {
        signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
      }
      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx(tx) {
      return ctx.wallet.submitTransaction(tx) as any;
    },
  };
};

// ─── Wallet construction ─────────────────────────────────────────────────────

export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((state) => state.isSynced),
    ),
  );

export const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.filter((state) => state.isSynced),
      Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
      Rx.filter((balance) => balance > 0n),
    ),
  );

const buildShieldedConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
});

const buildUnshieldedConfig = ({ indexer, indexerWS }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  txHistoryStorage: new NoOpTransactionHistoryStorage(),
});

const buildDustConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
});

/**
 * Derive HD keys for Zswap, NightExternal and Dust roles from the wallet
 * secret. `secret` may be a 64-char hex seed or a BIP39 recovery phrase (what
 * 1AM/Lace export); `seedBytesFromInput` normalizes both to seed bytes.
 */
const deriveKeysFromSeed = (secret: string) => {
  const derivation = resolveDerivation(process.env.SEED_DERIVATION);
  const hdWallet = HDWallet.fromSeed(seedBytesFromInput(secret, derivation));
  if (hdWallet.type !== 'seedOk') {
    throw new Error('Failed to initialize HDWallet from seed');
  }
  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derivationResult.type !== 'keysDerived') {
    throw new Error('Failed to derive keys');
  }
  hdWallet.hdWallet.clear();
  return derivationResult.keys;
};

const formatBalance = (balance: bigint): string => balance.toLocaleString();

export const withStatus = async <T>(message: string, fn: () => Promise<T>): Promise<T> => {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${frames[i++ % frames.length]} ${message}`);
  }, 80);
  try {
    const result = await fn();
    clearInterval(interval);
    process.stdout.write(`\r  ✓ ${message}\n`);
    return result;
  } catch (e) {
    clearInterval(interval);
    process.stdout.write(`\r  ✗ ${message}\n`);
    throw e;
  }
};

/**
 * Register unshielded NIGHT UTXOs for dust generation. On preprod, NIGHT
 * generates DUST (the fee token) only after the UTXOs are designated for it.
 */
const registerForDustGeneration = async (wallet: WalletFacade, unshieldedKeystore: UnshieldedKeystore): Promise<void> => {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));

  if (state.dust.availableCoins.length > 0) {
    const dustBal = state.dust.balance(new Date());
    console.log(`  ✓ Dust tokens already available (${formatBalance(dustBal)} DUST)`);
    return;
  }

  const nightUtxos = state.unshielded.availableCoins.filter(
    (coin: any) => coin.meta?.registeredForDustGeneration !== true,
  );
  if (nightUtxos.length === 0) {
    await withStatus('Waiting for dust tokens to generate', () =>
      Rx.firstValueFrom(
        wallet.state().pipe(
          Rx.throttleTime(5_000),
          Rx.filter((s) => s.isSynced),
          Rx.filter((s) => s.dust.balance(new Date()) > 0n),
        ),
      ),
    );
    return;
  }

  await withStatus(`Registering ${nightUtxos.length} NIGHT UTXO(s) for dust generation`, async () => {
    const recipe = await wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      unshieldedKeystore.getPublicKey(),
      (payload) => unshieldedKeystore.signData(payload),
    );
    const finalized = await wallet.finalizeRecipe(recipe);
    await wallet.submitTransaction(finalized);
  });

  await withStatus('Waiting for dust tokens to generate', () =>
    Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(5_000),
        Rx.filter((s) => s.isSynced),
        Rx.filter((s) => s.dust.balance(new Date()) > 0n),
      ),
    ),
  );
};

const printWalletSummary = (state: any, unshieldedKeystore: UnshieldedKeystore) => {
  const networkId = getNetworkId();
  const unshieldedBalance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;

  const coinPubKey = ShieldedCoinPublicKey.fromHexString(state.shielded.coinPublicKey.toHexString());
  const encPubKey = ShieldedEncryptionPublicKey.fromHexString(state.shielded.encryptionPublicKey.toHexString());
  const shieldedAddress = MidnightBech32m.encode(networkId, new ShieldedAddress(coinPubKey, encPubKey)).toString();

  const DIV = '──────────────────────────────────────────────────────────────';
  console.log(`
${DIV}
  Wallet Overview                            Network: ${networkId}
${DIV}

  Shielded (ZSwap)
  └─ Address: ${shieldedAddress}

  Unshielded
  ├─ Address: ${unshieldedKeystore.getBech32Address()}
  └─ Balance: ${formatBalance(unshieldedBalance)} tNight

  Dust
  └─ Address: ${MidnightBech32m.encode(networkId, state.dust.address).toString()}

${DIV}`);
};

/** Initialize the facade, restoring any component that has a saved checkpoint. */
const initFacade = async (
  config: Config,
  shieldedSecretKeys: ledger.ZswapSecretKeys,
  dustSecretKey: ledger.DustSecretKey,
  unshieldedKeystore: UnshieldedKeystore,
  saved: WalletStateSnapshot | null,
): Promise<WalletFacade> => {
  const walletConfig = {
    ...buildShieldedConfig(config),
    ...buildUnshieldedConfig(config),
    ...buildDustConfig(config),
  };
  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (cfg) =>
      saved?.shielded ? ShieldedWallet(cfg).restore(saved.shielded) : ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) =>
      saved?.unshielded
        ? UnshieldedWallet(cfg).restore(saved.unshielded)
        : UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) =>
      saved?.dust
        ? DustWallet(cfg).restore(saved.dust)
        : DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return wallet;
};

/** Snapshot each component's serialized state from a facade state. */
const snapshotFrom = (s: any): WalletStateSnapshot => ({
  shielded: s?.shielded?.serialize?.(),
  unshielded: s?.unshielded?.serialize?.(),
  dust: s?.dust?.serialize?.(),
  savedAt: new Date().toISOString(),
});

/**
 * Checkpoint wallet state to disk (throttled) for the duration of the session,
 * printing sync progress. Makes the slow first sync resumable across restarts
 * and lets later runs restore instead of re-syncing from index 0.
 */
const startCheckpointing = (wallet: WalletFacade, stateFile: string): Rx.Subscription =>
  wallet
    .state()
    .pipe(Rx.throttleTime(30_000, undefined, { leading: false, trailing: true }))
    .subscribe((s: any) => {
      try {
        saveWalletState(stateFile, snapshotFrom(s));
        const pct = (a: any, t: any) => (t && Number(t) > 0 ? `${((Number(a) / Number(t)) * 100).toFixed(1)}%` : '—');
        const dp = s?.dust?.progress ?? {};
        const sp = s?.shielded?.progress ?? {};
        process.stdout.write(
          `\r  ⟳ sync — dust ${pct(dp.appliedIndex, dp.highestRelevantWalletIndex)} ` +
            `(${dp.appliedIndex}/${dp.highestRelevantWalletIndex}), shielded ${pct(sp.appliedIndex, sp.highestRelevantWalletIndex)}, ` +
            `synced=${s?.isSynced}      \n`,
        );
      } catch {
        /* checkpoint is best-effort */
      }
    });

/** Build (or restore) a wallet from a seed/recovery phrase and wait for sync + funds. */
export const buildWalletAndWaitForFunds = async (config: Config, seed: string): Promise<WalletContext> => {
  console.log('');

  const keys = deriveKeysFromSeed(seed);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());
  const address = String(unshieldedKeystore.getBech32Address());
  const stateFile = walletStatePath(config.networkId, address);
  const saved = loadWalletState(stateFile);

  const wallet = await withStatus(saved ? 'Restoring saved wallet state' : 'Building wallet', async () => {
    try {
      return await initFacade(config, shieldedSecretKeys, dustSecretKey, unshieldedKeystore, saved);
    } catch (e) {
      if (saved) {
        // Corrupt or incompatible checkpoint — discard it and start fresh.
        clearWalletState(stateFile);
        return await initFacade(config, shieldedSecretKeys, dustSecretKey, unshieldedKeystore, null);
      }
      throw e;
    }
  });

  const networkId = getNetworkId();
  const DIV = '──────────────────────────────────────────────────────────────';
  console.log(`
${DIV}
  Wallet Overview                            Network: ${networkId}
${DIV}
  Unshielded Address (send tNight here):
  ${address}

  Confirm this matches the address shown in your 1AM wallet. Fund it with
  tNight from the Preprod faucet if needed:
  https://faucet.preprod.midnight.network/
${DIV}
`);
  if (saved) {
    console.log(`  Resuming from checkpoint saved ${saved.savedAt} — syncing only the delta.\n`);
  } else {
    console.log('  First sync of this wallet can take a while (full history). Progress is\n  checkpointed every ~30s, so it resumes if interrupted.\n');
  }

  const checkpoint = startCheckpointing(wallet, stateFile);
  const syncedState = await withStatus('Syncing with network', () => waitForSync(wallet));
  // Persist the fully-synced state so future runs start instantly.
  try {
    saveWalletState(stateFile, snapshotFrom(syncedState));
  } catch {
    /* best-effort */
  }
  printWalletSummary(syncedState, unshieldedKeystore);

  const balance = syncedState.unshielded.balances[unshieldedToken().raw] ?? 0n;
  if (balance === 0n) {
    const fundedBalance = await withStatus('Waiting for incoming tokens', () => waitForFunds(wallet));
    console.log(`    Balance: ${formatBalance(fundedBalance)} tNight\n`);
  }

  await registerForDustGeneration(wallet, unshieldedKeystore);

  // Keep checkpointing through the session so resumes stay fast; the process
  // exits shortly after, which tears the subscription down.
  void checkpoint;

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

/** Create a fresh wallet with a random seed; prints the seed once. */
export const buildFreshWallet = async (config: Config): Promise<WalletContext> => {
  const seed = toHex(Buffer.from(generateRandomSeed()));
  const DIV = '──────────────────────────────────────────────────────────────';
  console.log(`
${DIV}
  New Wallet Seed — save this before continuing
${DIV}
  ${seed}
${DIV}
`);
  return await buildWalletAndWaitForFunds(config, seed);
};

export const getDustBalance = async (wallet: WalletFacade): Promise<bigint> => {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return state.dust.balance(new Date());
};

/** Wire together all midnight-js providers for deploy + interaction. */
export const configureProviders = async (ctx: WalletContext, config: Config): Promise<WordleProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<any>(contractConfig.zkConfigPath);
  const accountId = walletAndMidnightProvider.getCoinPublicKey();
  const storagePassword = `${Buffer.from(accountId, 'hex').toString('base64')}!`;
  return {
    privateStateProvider: levelPrivateStateProvider<typeof WordlePrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      accountId,
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  } as unknown as WordleProviders;
};

export function setLogger(_logger: Logger) {
  logger = _logger;
}
