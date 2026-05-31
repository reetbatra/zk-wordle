// SPDX-License-Identifier: Apache-2.0
import { Wordle, type WordlePrivateState } from '@zk-wordle/contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js/types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js/contracts';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';

export type WordleCircuits = ProvableCircuitId<Wordle.Contract<WordlePrivateState>>;

export const WordlePrivateStateId = 'wordlePrivateState';

export type WordleProviders = MidnightProviders<WordleCircuits, typeof WordlePrivateStateId, WordlePrivateState>;

export type WordleContract = Wordle.Contract<WordlePrivateState>;

export type DeployedWordleContract = DeployedContract<WordleContract> | FoundContract<WordleContract>;
