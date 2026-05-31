import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum GameStatus { Empty = 0, Playing = 1, Won = 2, Lost = 3 }

export type Witnesses<PS> = {
  localSecretWord(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint[]];
  localSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  newGame(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  submitGuess(context: __compactRuntime.CircuitContext<PS>, guess_0: bigint[]): __compactRuntime.CircuitResults<PS, bigint[]>;
}

export type ProvableCircuits<PS> = {
  newGame(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  submitGuess(context: __compactRuntime.CircuitContext<PS>, guess_0: bigint[]): __compactRuntime.CircuitResults<PS, bigint[]>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  newGame(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  submitGuess(context: __compactRuntime.CircuitContext<PS>, guess_0: bigint[]): __compactRuntime.CircuitResults<PS, bigint[]>;
}

export type Ledger = {
  readonly commitment: Uint8Array;
  readonly status: GameStatus;
  readonly attempts: bigint;
  guesses: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): bigint[];
    [Symbol.iterator](): Iterator<[bigint, bigint[]]>
  };
  clues: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): bigint[];
    [Symbol.iterator](): Iterator<[bigint, bigint[]]>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
