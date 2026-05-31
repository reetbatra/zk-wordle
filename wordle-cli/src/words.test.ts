import { describe, it, expect, vi } from 'vitest';
import { pickRandomWord, WORDS } from './words.js';

describe('words', () => {
  describe('WORDS', () => {
    it('should contain only 5-letter lowercase words', () => {
      for (const word of WORDS) {
        expect(word).toMatch(/^[a-z]{5}$/);
      }
    });

    it('should have no duplicates', () => {
      const unique = new Set(WORDS);
      expect(unique.size).toBe(WORDS.length);
    });

    it('should have exactly 50 words', () => {
      expect(WORDS.length).toBe(50);
    });
  });

  describe('pickRandomWord', () => {
    it('should return a word from WORDS', () => {
      const word = pickRandomWord();
      expect(WORDS).toContain(word);
    });

    it('should return 5-letter lowercase words', () => {
      for (let i = 0; i < 100; i++) {
        const word = pickRandomWord();
        expect(word).toMatch(/^[a-z]{5}$/);
      }
    });

    it('should be random (statistical check)', () => {
      const counts = new Map<string, number>();
      const iterations = 1000;
      const threshold = 5; // Expected count per word

      for (let i = 0; i < iterations; i++) {
        const word = pickRandomWord();
        counts.set(word, (counts.get(word) || 0) + 1);
      }

      // Check that most words were picked at least once
      const pickedCount = [...counts.values()].filter(c => c > 0).length;
      expect(pickedCount).toBeGreaterThan(40);
    });
  });
});