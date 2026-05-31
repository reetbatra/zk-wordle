# zk-wordle

A privacy-preserving Wordle game built on Midnight using zero-knowledge proofs. The secret word is committed as a hash on-chain, and every clue is a ZK proof — the word itself is never revealed.

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
└── wordle-cli/         # CLI game interface
    └── src/
        ├── preprod.ts           # Entry point
        ├── game.ts              # Game loop and UI
        ├── api.ts               # Wallet, providers, contract operations
        ├── config.ts            # Configuration
        └── words.ts             # Word list (50 5-letter words)
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

## Usage

### Build the project:
```bash
npm run build
```

### Play the game:
```bash
npm run play
```

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