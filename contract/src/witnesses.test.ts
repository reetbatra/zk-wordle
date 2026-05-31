import { describe, it, expect } from 'vitest';
import { createWordlePrivateState, type WordlePrivateState } from './witnesses.js';

describe('witnesses', () => {
  describe('createWordlePrivateState', () => {
    it('should create valid private state from 5-letter word', () => {
      const word = 'hello';
      const salt = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        salt[i] = Math.floor(Math.random() * 256);
      }

      const state = createWordlePrivateState(word, salt);

      expect(state.secretWord).toHaveLength(5);
      expect(state.secretWord).toEqual([
        BigInt('h'.charCodeAt(0)),
        BigInt('e'.charCodeAt(0)),
        BigInt('l'.charCodeAt(0)),
        BigInt('l'.charCodeAt(0)),
        BigInt('o'.charCodeAt(0)),
      ]);
      expect(state.salt).toBe(salt);
      expect(state.salt.length).toBe(32);
    });

    it('should convert uppercase to lowercase', () => {
      const word = 'HELLO';
      const salt = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        salt[i] = Math.floor(Math.random() * 256);
      }

      const state = createWordlePrivateState(word, salt);

      expect(state.secretWord).toEqual([
        BigInt('h'.charCodeAt(0)),
        BigInt('e'.charCodeAt(0)),
        BigInt('l'.charCodeAt(0)),
        BigInt('l'.charCodeAt(0)),
        BigInt('o'.charCodeAt(0)),
      ]);
    });

    it('should throw if word length is not 5', () => {
      const salt = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        salt[i] = Math.floor(Math.random() * 256);
      }

      expect(() => createWordlePrivateState('hi', salt)).toThrow('secret word must be exactly 5 letters');
      expect(() => createWordlePrivateState('helloo', salt)).toThrow('secret word must be exactly 5 letters');
    });

    it('should throw if word contains non-letters', () => {
      const salt = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        salt[i] = Math.floor(Math.random() * 256);
      }

      expect(() => createWordlePrivateState('hell0', salt)).toThrow('secret word must be lowercase a-z only');
      expect(() => createWordlePrivateState('hel1o', salt)).toThrow('secret word must be lowercase a-z only');
    });

    it('should throw if salt is not 32 bytes', () => {
      expect(() => createWordlePrivateState('hello', new Uint8Array(16))).toThrow('salt must be 32 bytes');
      expect(() => createWordlePrivateState('hello', new Uint8Array(64))).toThrow('salt must be 32 bytes');
    });
  });
});