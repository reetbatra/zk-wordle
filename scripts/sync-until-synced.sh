#!/usr/bin/env bash
# Drive a fresh wallet's one-time first sync to completion.
#
# A fresh Midnight wallet must replay the chain's whole event history; on preprod
# the dust wallet is ~915k indices, and its per-batch rate decays as in-process
# memory grows. The app checkpoints wallet state to disk (.midnight/) every ~30s,
# so this driver runs the e2e in short bursts and restarts it: each restart
# resumes from the last checkpoint AND resets process memory, which restores the
# fast early sync rate. Net effect: the long first sync completes across several
# bursts instead of crawling (or OOMing) in one.
#
# A burst is only time-capped while STILL SYNCING. Once it gets past sync (the
# wallet deploys the contract and submits the real ZK proofs), the driver lets it
# run to completion and exits 0 on a clean "END-TO-END PASS".
#
# Env: ATTEMPT_SECS (per-burst cap while syncing, default 180), MAX_ATTEMPTS (80).
set -u
cd "$(dirname "$0")/.."

ATTEMPT_SECS=${ATTEMPT_SECS:-180}
MAX_ATTEMPTS=${MAX_ATTEMPTS:-80}
HEAP=${HEAP:-8192}
LOG=/tmp/zkw_sync_driver.out

echo "Building once…"
npm run build >/tmp/zkw_sync_build.log 2>&1 || { echo "build failed"; tail -5 /tmp/zkw_sync_build.log; exit 2; }

for n in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "── burst $n/$MAX_ATTEMPTS (cap ${ATTEMPT_SECS}s while syncing) ──"
  node --max-old-space-size="$HEAP" wordle-cli/dist/e2e.js >"$LOG" 2>&1 &
  pid=$!
  synced=0
  s=0
  while kill -0 "$pid" 2>/dev/null; do
    grep -aqE 'allSynced=true|Deploying contract|Configuring providers' "$LOG" && synced=1
    grep -aq 'END-TO-END' "$LOG" && break
    sleep 5; s=$((s + 5))
    if [ "$synced" -eq 0 ] && [ "$s" -ge "$ATTEMPT_SECS" ]; then
      echo "   time cap while still syncing — restarting to reset memory"
      break
    fi
  done

  # If past sync, let deploy + proofs finish naturally before judging.
  [ "$synced" -eq 1 ] && wait "$pid" 2>/dev/null

  if grep -aq 'END-TO-END PASS' "$LOG"; then
    echo "✅ SYNC + E2E COMPLETE on burst $n"
    grep -aE 'Contract:|on-chain clue|Solved|END-TO-END' "$LOG" | grep -v '⟳'
    exit 0
  fi
  if grep -aq 'END-TO-END FAILED' "$LOG"; then
    echo "⚠ sync completed but e2e checks failed — see $LOG"
    grep -aE 'Contract:|✗|mismatch|FAILED' "$LOG" | grep -v '⟳' | head
    exit 3
  fi

  pkill -9 -f 'dist/e2e.js' 2>/dev/null
  sleep 2
  echo "   progress: $(grep -ao 'dust [0-9.]*% ([0-9]*/[0-9]*)' "$LOG" | tail -1)  $(grep -ao 'shielded [0-9.]*%' "$LOG" | tail -1)"
done

echo "⚠ reached MAX_ATTEMPTS without a full green run; checkpoint is preserved — rerun to continue."
exit 1
