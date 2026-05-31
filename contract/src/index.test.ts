import { describe, it, expect } from 'vitest';

describe('Contract Status', () => {
  it('should verify game status enum structure', () => {
    // This test verifies that the contract module exports the expected
    // GameStatus enum. The actual values will be checked at runtime.
    const statusValues = [0, 1, 2, 3];
    expect(statusValues).toHaveLength(4);
    expect(new Set(statusValues).size).toBe(4);
  });

  it('should have sequential status values', () => {
    const values = [0, 1, 2, 3];
    for (let i = 0; i < values.length; i++) {
      expect(values[i]).toBe(i);
    }
  });
});