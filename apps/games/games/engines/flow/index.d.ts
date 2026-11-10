export type Quality = number | boolean | string | string[];
export type Qualities = Record<string, Quality>;
export type Scope = 'player' | 'partner' | 'pair' | 'table' | 'session';
export interface Player { id: string; name: string; qualities?: Qualities }
export interface Binding { actor?: string; partner?: string }
export interface World {
  players: Record<string, { name: string; qualities: Qualities }>;
  pairs: Record<string, Qualities>;
  table: Qualities;
  session: Qualities;
}
export type Condition = { all: Condition[] } | { any: Condition[] } | { not: Condition }
  | { scope: Scope; key: string; op: 'eq' | 'neq'; value: Quality }
  | { scope: Scope; key: string; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number }
  | { scope: Scope; key: string; op: 'includes'; value: string }
  | { scope: Scope; key: string; op: 'exists'; value?: boolean };
export type Effect = { scope: Scope; key: string } & (
  { op: 'set'; value: Quality } | { op: 'add'; value: number } | { op: 'append'; value: string }
);
export type Card = {
  id: string; tags?: string[]; when?: Condition;
  effects?: Effect[]; weight?: number; heat?: number; phases?: string[];
  roles?: 0 | 1 | 2; breather?: boolean;
} & ({ text: string; template?: never } | { template: string; text?: never });
export interface Phase {
  id: string; dwell: [number, number]; when?: Condition; prerequisites?: string[];
  next?: { to: string; when?: Condition; weight?: number }[];
  terminal?: boolean; breather?: boolean;
}
export interface Rule {
  id: string; group: string; when?: Condition; priority?: number;
  tagWeights?: Record<string, number>; maxHeat?: number;
}
export interface Director {
  curve: [number, number][]; maxHeat?: number; breatherEvery?: number; breatherHeat?: number;
  recencyWindow?: number; noveltyBonus?: number; fairness?: number; heatTolerance?: number;
}
export interface Definition {
  schemaVersion: 1; id: string; version: string; cards: Card[]; start: string;
  phases: Phase[]; rules?: Rule[]; grammar?: Record<string, string[]>; slots?: string[];
  director?: Director; repeat?: 'never' | 'cycle';
}
export interface Request extends Binding {
  tagsAll?: string[]; tagsAny?: string[]; excludeIds?: string[]; slots?: Record<string, string>;
}
export interface Offer {
  status: 'offered'; token: string; id: string; text: string; phase: string;
  binding: Binding; tags: string[]; heat: number; targetHeat: number;
  breather: boolean; rules: string[];
}
export type DrawResult = Offer | { status: 'done' } | { status: 'dead-end'; reason: string };
export interface HistoryRow {
  id: string; text: string; phase: string; tags: string[]; heat: number; targetHeat: number;
  binding: Binding; outcome: 'pending' | 'complete' | 'skip';
}
export interface State {
  seed: string; world: World; phase: string; dwell: number; completed: number;
  completedPhases: string[]; turn: number; sinceBreather: number;
  seen: string[]; seenText: string[]; history: HistoryRow[];
  exposure: Record<string, number>; pairExposure: Record<string, number>; pending: Offer | null;
}
/** Private server state, never include in a game view. Content signature must match. */
export interface Snapshot { schemaVersion: 1; definition: string; rng: number; state: State }
export type Validator = (definition: Definition) => string[];
export interface Options {
  seed?: string | number; players?: Player[]; table?: Qualities; session?: Qualities;
  validators?: Validator[]; snapshot?: Snapshot;
}
export interface Engine {
  draw(request?: Request): DrawResult;
  complete(token: string): boolean;
  skip(token: string): boolean;
  setQuality(scope: Scope, key: string, value: Quality, binding?: Binding): void;
  snapshot(): Snapshot;
  inspect(): State;
}
export function createEngine(definition: Definition, options?: Options): Engine;
export function validateDefinition(definition: unknown, validators?: Validator[]): string[];
export function targetHeat(curve: [number, number][], turn: number): number;
export function normalize(text: string): string;
export function pairKey(a: string, b: string): string;
