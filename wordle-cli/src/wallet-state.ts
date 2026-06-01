// SPDX-License-Identifier: Apache-2.0
//
// Wallet-state persistence. A fresh Midnight wallet must replay the chain's
// whole event history on first sync — on preprod the dust wallet alone is
// ~900k indices and grinds for a very long time. To make that survivable we
// checkpoint each wallet component's serialized state to disk during sync, so:
//   • a later run restores instead of re-syncing from index 0, and
//   • if a run is killed/OOMs mid-sync, the next run resumes from the last
//     checkpoint instead of starting over (and a fresh process resets memory,
//     which restores the fast early sync rate).
//
// State lives under .midnight/ (gitignored) keyed by network + wallet address.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stateDir = path.join(projectRoot, '.midnight', 'wallet-state');

/** Serialized state for each wallet component (each is the SDK's opaque string). */
export interface WalletStateSnapshot {
  shielded?: string;
  unshielded?: string;
  dust?: string;
  savedAt: string;
}

/** Per-wallet, per-network state file path. Address is public, but we hash it for a tidy name. */
export const walletStatePath = (networkId: string, address: string): string => {
  const tag = createHash('sha256').update(address).digest('hex').slice(0, 16);
  return path.join(stateDir, `${networkId}-${tag}.json`);
};

export const loadWalletState = (file: string): WalletStateSnapshot | null => {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as WalletStateSnapshot;
    if (parsed && (parsed.shielded || parsed.unshielded || parsed.dust)) return parsed;
    return null;
  } catch {
    return null; // missing or corrupt → treat as no saved state
  }
};

/** Atomic write (tmp + rename) so a crash mid-write can't corrupt the checkpoint. */
export const saveWalletState = (file: string, snapshot: WalletStateSnapshot): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot), 'utf8');
  fs.renameSync(tmp, file);
};

export const clearWalletState = (file: string): void => {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
};
