// SPDX-License-Identifier: Apache-2.0
//
// Candidate secret words. v1 keeps this list small and self-contained; the
// only on-chain validation is length == 5 (see wordle.compact). Adding a full
// dictionary check for *guesses* is noted as future work in the README.
export const WORDS: readonly string[] = [
  'apple', 'brave', 'crane', 'doubt', 'eagle',
  'flame', 'grape', 'haunt', 'ivory', 'joker',
  'knead', 'lemon', 'mango', 'noble', 'ocean',
  'pride', 'quilt', 'raven', 'spice', 'tiger',
  'ultra', 'vivid', 'wharf', 'xenon', 'yacht',
  'zebra', 'amber', 'blaze', 'cabin', 'depth',
  'ember', 'frost', 'glide', 'hinge', 'inlet',
  'jelly', 'kayak', 'latch', 'mirth', 'nudge',
  'olive', 'plumb', 'quack', 'rinse', 'slate',
  'twang', 'unzip', 'vault', 'wrist', 'zesty',
];

export const pickRandomWord = (): string => WORDS[Math.floor(Math.random() * WORDS.length)];
