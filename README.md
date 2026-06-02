# zk-wordle

A privacy-preserving Wordle game built on Midnight using zero-knowledge proofs. The secret word is committed as a hash on-chain, and every clue is a ZK proof — the word itself is never revealed.

## Live on preprod

This has run end-to-end on Midnight's **preprod testnet** with real ZK proofs — not just locally.

- **Deployed contract:** `f94103ebdebdd47f4168e6a8e12f7503352a4289718166de0a4880568bbc1409`
- A secret word (`CRANE`) was committed, three guesses (`SLATE → REACT → CRANE`) were each submitted with a **real ZK proof** through a local proof server, and **every on-chain clue was verified** against an independent reference implementation of the Wordle rule. Game won in 3 — status `Won`, confirmed on chain.

Reproduce it yourself (non-interactive):

```bash
npm run sync   # one-time wallet sync (resumable; see "First sync" below)
npm run e2e    # deploy a fresh contract + submit 3 real ZK proofs, verifying each on-chain clue
```

## How It Works

1. **Host picks a secret word** locally and generates a random salt
2. **Commits hash to blockchain** via the `newGame` transaction — only the hash is public
3. **Player submits guesses** — each guess generates a ZK proof that the clue is correct
4. **ZK circuit proves**: "Given a secret word that hashes to the published commitment, this clue is the correct Wordle feedback"
5. **Neither the word nor salt ever leave the host's machine**

## Architecture

```
zk-wordle/
├── contract/           # ZK circuit (Compact language) → TS bindings
│   └── src/
│       ├── wordle.compact       # ZK circuit definition
│       ├── witnesses.ts         # TS witness implementations (secret word + salt)
│       └── managed/             # Generated TS contract bindings
├── wordle-cli/         # CLI game interface
│   └── src/
│       ├── preprod.ts           # Interactive game entry point
│       ├── game.ts              # Game loop and UI
│       ├── api.ts               # Wallet, providers, contract operations
│       ├── wallet-state.ts      # Resumable wallet-state checkpoint/restore
│       ├── e2e.ts               # Non-interactive end-to-end test (real ZK proofs)
│       ├── deploy.ts            # Deploy a contract non-interactively
│       ├── address.ts           # Print wallet addresses without syncing
│       ├── seed.ts              # Hex-seed / BIP39 recovery-phrase key derivation
│       ├── config.ts            # Configuration
│       └── words.ts             # Word list (50 5-letter words)
└── scripts/
    └── sync-until-synced.sh     # Drives the one-time first sync to completion
```

## Prerequisites

- **Node.js** >= 24
- **Docker** or **Colima** (for local proof server)
- **tNight tokens** on Midnight preprod testnet

## Setup

1. Clone the repo:
```bash
git clone <repo-url>
cd zk-wordle
```

2. Install dependencies:
```bash
npm install
```

3. Start the local proof server (keeps witnesses private). Use whichever you have:
```bash
docker compose -f proof-server.yml up -d   # Docker Compose plugin installed
npm run proof-server                       # plain `docker run`, no plugin needed
```

4. Configure environment:
```bash
cp .env.example .env
# Edit .env and set WALLET_SEED — a 64-char hex seed OR your 1AM/Lace
# 24-word recovery phrase. The CLI accepts either.
```

5. Fund your wallet:
- The CLI prints your unshielded address on first run
- Get tNight from the faucet: https://faucet.preprod.midnight.network/

6. Run the one-time wallet sync:
```bash
npm run sync
```

## First sync

A brand-new wallet has to replay the chain's whole history to compute its balances. On preprod the **dust** wallet alone is ~900k events, and its per-batch rate decays as memory grows — so a single naive sync crawls for hours.

`npm run sync` solves this: the wallet checkpoints its serialized state to `.midnight/` (gitignored) every ~30s, and the driver runs the sync in short bursts, **restarting to reset memory and resume from the last checkpoint**. This keeps the sync rate high and completes the one-time first sync in a series of bursts (~20–30 min). After that, every `npm run play` / `e2e` / `deploy` **restores from the checkpoint and starts in seconds** — only the small delta since last run is synced.

If a sync is interrupted, just run `npm run sync` again; it resumes where it left off.

## Usage

### Build the project:
```bash
npm run build
```

### Play the game:
```bash
npm run play
```

### Non-interactive end-to-end (real ZK proofs):
```bash
npm run e2e    # deploys a fresh contract, commits a word, submits 3 real ZK
               # proofs, and asserts each on-chain clue matches the reference rule
```
Configurable via `E2E_WORD` and `E2E_GUESSES` (e.g. `E2E_WORD=crane E2E_GUESSES=slate,react,crane`).

### Game options:
1. **Start a new game** — Pick a random word, deploy contract, commit hash
2. **Resume by address** — Rejoin a game you created (requires local private state)
3. **Exit**

### Gameplay:
- Enter 5-letter lowercase guesses (a-z)
- Green = correct letter, correct position
- Yellow = correct letter, wrong position
- Gray = letter not in word
- Type `:quit` or `:q` to pause

## The ZK Circuit

The `wordle.compact` circuit defines:

**Public ledger state:**
- `commitment` — hash of secret word + salt
- `status` — Empty, Playing, Won, Lost
- `attempts` — number of guesses submitted
- `guesses` — history of all guesses
- `clues` — history of all clues

**Private witnesses (host only):**
- `localSecretWord()` — the 5-letter solution
- `localSalt()` — 32-byte random salt

**Circuits:**
- `newGame()` — Commit to secret word via hash disclosure
- `submitGuess()` — Prove clue correctness without revealing the word

## Word List

Currently uses a curated list of 50 common 5-letter words. Future work may include:
- Full dictionary validation on-chain
- Merkle-tree based word list for efficient commitment
- Difficulty levels

## Development

### Contract workflow:
```bash
cd contract
npm run compact    # Compile Compact circuit to TS
npm run build      # Build TS with generated bindings
```

### CLI workflow:
```bash
cd wordle-cli
npm run build      # Build CLI
npm run play       # Run the game
```

### Tests:
```bash
npm test           # Run all tests
```

## Network

Runs on Midnight's `preprod` testnet by default. Change `NETWORK_ID` in `.env` to:
- `preprod` — Shared testnet (recommended)
- `preview` — Alternate public testnet
- `undeployed` — Fully local (requires running node/indexer locally)

## Privacy Model

- **Proof server runs locally** — witnesses never leave your machine
- **Secret word never revealed** — only hash and clues are on-chain
- **Resume requires local store** — only the host can resume their own game

## License

Apache-2.0

## Resources

- [Midnight Docs](https://docs.midnight.network/)
- [Compact Language](https://docs.midnight.network/compact)
- [Midnight.js SDK](https://docs.midnight.network/midnight-js)
- [Preprod Faucet](https://faucet.preprod.midnight.network/)