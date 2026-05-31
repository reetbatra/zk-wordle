// SPDX-License-Identifier: Apache-2.0
import path from 'node:path';
import { setNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js/network-id';

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

export const contractConfig = {
  privateStateStoreName: 'wordle-private-state',
  zkConfigPath: path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'wordle'),
};

export interface Config {
  readonly logDir: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
  readonly networkId: string;
}

const env = (key: string, fallback: string): string => {
  const v = process.env[key];
  return v !== undefined && v !== '' ? v : fallback;
};

/**
 * Build the runtime config from environment variables (.env), defaulting to
 * Midnight's preprod testnet with a local proof server. Calls setNetworkId as
 * a side effect so the rest of midnight-js uses the right network.
 */
export const loadConfig = (): Config => {
  const networkId = env('NETWORK_ID', 'preprod');
  setNetworkId(networkId as NetworkId);

  return {
    networkId,
    logDir: path.resolve(currentDir, '..', 'logs', networkId, `${new Date().toISOString()}.log`),
    indexer: env('MN_INDEXER', 'https://indexer.preprod.midnight.network/api/v3/graphql'),
    indexerWS: env('MN_INDEXER_WS', 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws'),
    node: env('MN_NODE', 'https://rpc.preprod.midnight.network'),
    proofServer: env('MN_PROOF_SERVER', 'http://127.0.0.1:6300'),
  };
};
