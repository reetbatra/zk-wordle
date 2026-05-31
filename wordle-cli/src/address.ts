// SPDX-License-Identifier: Apache-2.0
//
// Print the wallet addresses derived from WALLET_SEED, without syncing. Fast
// way to confirm the recovery phrase / hex seed maps to the wallet you expect
// (the unshielded address shown here must match the one your 1AM wallet shows).
//
//   npm run address
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore, PublicKey } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { loadConfig } from './config.js';
import { seedBytesFromInput, resolveDerivation, looksLikeMnemonic } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '..', '..', '.env'));
} catch {
  /* fall back to real env */
}

loadConfig(); // sets network id from NETWORK_ID
const networkId = getNetworkId();

const secret = process.env.WALLET_SEED?.trim();
if (!secret) {
  console.error('\n  ✗ WALLET_SEED is not set in .env.\n');
  process.exit(1);
}

const derivation = resolveDerivation(process.env.SEED_DERIVATION);
const seedBytes = seedBytesFromInput(secret, derivation);

const hd = HDWallet.fromSeed(seedBytes);
if (hd.type !== 'seedOk') {
  console.error('  ✗ Failed to initialize HDWallet from seed:', hd.error);
  process.exit(1);
}
const derived = hd.hdWallet
  .selectAccount(0)
  .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
  .deriveKeysAt(0);
if (derived.type !== 'keysDerived') {
  console.error('  ✗ Failed to derive keys');
  process.exit(1);
}
const keys = derived.keys;
hd.hdWallet.clear();

const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], networkId);
PublicKey.fromKeyStore(unshieldedKeystore); // validates keystore wiring

// In ledger-v8 these accessors already return hex strings.
const coinPubKey = ShieldedCoinPublicKey.fromHexString(shieldedSecretKeys.coinPublicKey);
const encPubKey = ShieldedEncryptionPublicKey.fromHexString(shieldedSecretKeys.encryptionPublicKey);
const shieldedAddress = MidnightBech32m.encode(networkId, new ShieldedAddress(coinPubKey, encPubKey)).toString();

const DIV = '──────────────────────────────────────────────────────────────';
const kind = looksLikeMnemonic(secret) ? `recovery phrase (${derivation} derivation)` : 'hex seed';
console.log(`
${DIV}
  Derived wallet addresses                    Network: ${networkId}
  Source: ${kind}   |   seed bytes: ${seedBytes.length}
${DIV}

  Unshielded (tNight) — compare this to your 1AM wallet:
  ${unshieldedKeystore.getBech32Address()}

  Shielded (ZSwap):
  ${shieldedAddress}
${DIV}
`);
process.exit(0);
