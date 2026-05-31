// SPDX-License-Identifier: Apache-2.0
//
// Wallet secret → seed bytes. Accepts either a raw hex seed or a BIP39
// recovery phrase, because real wallets (1AM, Lace) hand the user a 24-word
// recovery phrase rather than a hex seed.
import { Buffer } from 'node:buffer';
import { mnemonicToEntropy, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';

/**
 * How to turn a recovery phrase into the seed bytes fed to `HDWallet.fromSeed`:
 *
 *  - `entropy` (default): the BIP39 entropy the words encode (16–32 bytes).
 *    Midnight's own SDK pairs a 32-byte seed (`generateRandomSeed`) with a
 *    256-bit / 24-word mnemonic, so the entropy *is* the HD seed. This is what
 *    1AM / Lace–style Midnight wallets use.
 *  - `bip39`: the irreversible 64-byte PBKDF2 seed (`mnemonicToSeed`). Provided
 *    as an escape hatch for wallets that derive from the PBKDF2 seed instead.
 *
 * Select with the `SEED_DERIVATION` env var. A raw hex seed ignores this.
 */
export type SeedDerivation = 'entropy' | 'bip39';

export const resolveDerivation = (raw?: string): SeedDerivation =>
  raw === 'bip39' ? 'bip39' : 'entropy';

/** A whitespace-separated value with 12+ tokens is treated as a recovery phrase. */
export const looksLikeMnemonic = (input: string): boolean =>
  input.trim().split(/\s+/).length >= 12;

/**
 * Normalize a wallet secret — a 64-char hex seed OR a BIP39 recovery phrase —
 * into the raw seed bytes accepted by `@midnight-ntwrk/wallet-sdk-hd`'s
 * `HDWallet.fromSeed`.
 *
 * @throws if the phrase fails BIP39 checksum validation, or the value is
 *         neither a valid mnemonic nor a valid hex seed.
 */
export const seedBytesFromInput = (
  input: string,
  derivation: SeedDerivation = 'entropy',
): Uint8Array => {
  const s = input.trim().replace(/\s+/g, ' ');

  if (looksLikeMnemonic(s)) {
    if (!validateMnemonic(s, english)) {
      throw new Error(
        'WALLET_SEED looks like a recovery phrase but failed BIP39 validation — ' +
          'check the words and their order.',
      );
    }
    const bytes =
      derivation === 'bip39'
        ? (mnemonicToSeedSync(s) as unknown as Uint8Array)
        : (mnemonicToEntropy(s, english) as unknown as Uint8Array);
    return Uint8Array.from(bytes);
  }

  const hex = s.replace(/^0x/i, '');
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0 && hex.length >= 32) {
    return Uint8Array.from(Buffer.from(hex, 'hex'));
  }

  throw new Error(
    'WALLET_SEED must be a hex seed (>=32 hex chars) or a BIP39 recovery phrase (12-24 words).',
  );
};
