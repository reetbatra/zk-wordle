import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, type Config } from './config.js';

describe('config', () => {
  beforeEach(() => {
    // Clear environment variables before each test
    delete process.env.NETWORK_ID;
    delete process.env.MN_NODE;
    delete process.env.MN_INDEXER;
    delete process.env.MN_INDEXER_WS;
    delete process.env.MN_PROOF_SERVER;
  });

  afterEach(() => {
    // Reset to defaults
    process.env.NETWORK_ID = 'preprod';
    process.env.MN_NODE = 'https://rpc.preprod.midnight.network';
    process.env.MN_INDEXER = 'https://indexer.preprod.midnight.network/api/v3/graphql';
    process.env.MN_INDEXER_WS = 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws';
    process.env.MN_PROOF_SERVER = 'http://127.0.0.1:6300';
  });

  describe('loadConfig', () => {
    it('should load default config with no env vars', () => {
      const config = loadConfig();

      expect(config.networkId).toBe('preprod');
      expect(config.node).toBe('https://rpc.preprod.midnight.network');
      expect(config.indexer).toBe('https://indexer.preprod.midnight.network/api/v3/graphql');
      expect(config.indexerWS).toBe('wss://indexer.preprod.midnight.network/api/v3/graphql/ws');
      expect(config.proofServer).toBe('http://127.0.0.1:6300');
      expect(config.logDir).toMatch(/logs\/preprod\/.*\.log$/);
    });

    it('should use env vars when set', () => {
      process.env.NETWORK_ID = 'preview';
      process.env.MN_NODE = 'https://custom.node';
      process.env.MN_INDEXER = 'https://custom.indexer';
      process.env.MN_INDEXER_WS = 'wss://custom.indexer/ws';
      process.env.MN_PROOF_SERVER = 'http://custom.proof:7000';

      const config = loadConfig();

      expect(config.networkId).toBe('preview');
      expect(config.node).toBe('https://custom.node');
      expect(config.indexer).toBe('https://custom.indexer');
      expect(config.indexerWS).toBe('wss://custom.indexer/ws');
      expect(config.proofServer).toBe('http://custom.proof:7000');
    });

    it('should treat empty string env vars as unset', () => {
      process.env.NETWORK_ID = '';
      process.env.MN_NODE = '';

      const config = loadConfig();

      expect(config.networkId).toBe('preprod');
      expect(config.node).toBe('https://rpc.preprod.midnight.network');
    });

    it('should generate log paths with timestamps', () => {
      const config = loadConfig();
      expect(config.logDir).toMatch(/logs\/preprod\/\d{4}-\d{2}-\d{2}T.*\.log$/);
    });
  });

  describe('contractConfig', () => {
    it('should have correct contract config', async () => {
      const { contractConfig } = await import('./config.js');

      expect(contractConfig.privateStateStoreName).toBe('wordle-private-state');
      expect(contractConfig.zkConfigPath).toMatch(/contract\/src\/managed\/wordle$/);
    });
  });
});