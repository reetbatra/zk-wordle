// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';
import { seedBytesFromInput, looksLikeMnemonic, resolveDerivation } from './seed.js';

// Standard BIP39 test vectors (Trezor): all-zero entropy.
const ZERO_24 =
  'abandon abandon abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon abandon abandon art';
const ZERO_12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('seed', () => {
  describe('looksLikeMnemonic', () => {
    it('is true for 12+ space-separated tokens', () => {
      expect(looksLikeMnemonic(ZERO_12)).toBe(true);
      expect(looksLikeMnemonic(ZERO_24)).toBe(true);
    });
    it('tolerates extra/odd whitespace', () => {
      expect(looksLikeMnemonic(`  ${ZERO_24.replace(/ /g, '   ')}  `)).toBe(true);
    });
    it('is false for a hex seed', () => {
      expect(looksLikeMnemonic('00'.repeat(32))).toBe(false);
    });
  });

  describe('resolveDerivation', () => {
    it('defaults to entropy', () => {
      expect(resolveDerivation(undefined)).toBe('entropy');
      expect(resolveDerivation('')).toBe('entropy');
      expect(resolveDerivation('anything-else')).toBe('entropy');
    });
    it('honors bip39', () => {
      expect(resolveDerivation('bip39')).toBe('bip39');
    });
  });

  describe('seedBytesFromInput — recovery phrase', () => {
    it('decodes a 24-word phrase to its 32-byte entropy (all-zero vector)', () => {
      const seed = seedBytesFromInput(ZERO_24);
      expect(seed).toBeInstanceOf(Uint8Array);
      expect(seed.length).toBe(32);
      expect([...seed].every((b) => b === 0)).toBe(true);
    });

    it('decodes a 12-word phrase to its 16-byte entropy', () => {
      const seed = seedBytesFromInput(ZERO_12);
      expect(seed.length).toBe(16);
      expect([...seed].every((b) => b === 0)).toBe(true);
    });

    it('round-trips entropy -> mnemonic', () => {
      const seed = seedBytesFromInput(ZERO_24);
      expect(entropyToMnemonic(seed, english)).toBe(ZERO_24);
    });

    it('is whitespace-insensitive', () => {
      const a = seedBytesFromInput(ZERO_24);
      const b = seedBytesFromInput(`  ${ZERO_24.replace(/ /g, '  ')}\n`);
      expect([...a]).toEqual([...b]);
    });

    it('bip39 derivation yields a 64-byte PBKDF2 seed instead', () => {
      const entropy = seedBytesFromInput(ZERO_24, 'entropy');
      const pbkdf2 = seedBytesFromInput(ZERO_24, 'bip39');
      expect(entropy.length).toBe(32);
      expect(pbkdf2.length).toBe(64);
      expect([...entropy]).not.toEqual([...pbkdf2.slice(0, 32)]);
    });

    it('rejects a phrase with a bad checksum', () => {
      const bad = Array(24).fill('abandon').join(' '); // valid words, invalid checksum
      expect(() => seedBytesFromInput(bad)).toThrow(/BIP39 validation/);
    });
  });

  describe('seedBytesFromInput — hex seed', () => {
    it('decodes a 64-char hex seed to 32 bytes', () => {
      const seed = seedBytesFromInput('00'.repeat(32));
      expect(seed.length).toBe(32);
    });
    it('accepts an optional 0x prefix', () => {
      const seed = seedBytesFromInput('0x' + 'ab'.repeat(32));
      expect(seed.length).toBe(32);
      expect(seed[0]).toBe(0xab);
    });
    it('rejects too-short / non-hex / odd-length values', () => {
      expect(() => seedBytesFromInput('deadbeef')).toThrow(); // too short
      expect(() => seedBytesFromInput('xyz not hex')).toThrow();
      expect(() => seedBytesFromInput('abc')).toThrow(); // odd length
    });
  });
});
