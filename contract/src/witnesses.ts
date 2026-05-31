// SPDX-License-Identifier: Apache-2.0
//
// TS-side implementation of the Compact witnesses declared in
// wordle.compact. Only the host's local state knows the secret word
// and salt — the chain only ever sees `commitment = hash(word, salt)`.

import { Ledger } from "./managed/wordle/contract/index.js";
import { WitnessContext } from "@midnight-ntwrk/compact-runtime";

export type WordlePrivateState = {
  readonly secretWord: bigint[]; // 5 ASCII codes (lowercase a–z)
  readonly salt: Uint8Array;     // 32 random bytes
};

export const createWordlePrivateState = (
  secretWord: string,
  salt: Uint8Array,
): WordlePrivateState => {
  const lower = secretWord.toLowerCase();
  if (lower.length !== 5) {
    throw new Error(`secret word must be exactly 5 letters, got "${secretWord}"`);
  }
  if (!/^[a-z]{5}$/.test(lower)) {
    throw new Error(`secret word must be lowercase a-z only, got "${secretWord}"`);
  }
  if (salt.length !== 32) {
    throw new Error(`salt must be 32 bytes, got ${salt.length}`);
  }
  return {
    secretWord: Array.from(lower, (c) => BigInt(c.charCodeAt(0))),
    salt,
  };
};

export const witnesses = {
  localSecretWord: ({
    privateState,
  }: WitnessContext<Ledger, WordlePrivateState>): [WordlePrivateState, bigint[]] => [
    privateState,
    [...privateState.secretWord],
  ],
  localSalt: ({
    privateState,
  }: WitnessContext<Ledger, WordlePrivateState>): [WordlePrivateState, Uint8Array] => [
    privateState,
    privateState.salt,
  ],
};
