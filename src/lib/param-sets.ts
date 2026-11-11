/**
 * UX-3: named parameter sets per procedure, kept in this browser only. Connection details and
 * passwords are never stored here. Every storage call is guarded: a blocked or full store
 * means the sets are simply not saved, and the page keeps working.
 */

export interface SavedParam { name: string; type: string; value: string; isNull: boolean; output: boolean }
export type ParamSetStore = Record<string, Record<string, SavedParam[]>>;

export const PARAM_SET_KEY = 'sqllens.paramSets.v1';

const isSavedParam = (v: unknown): v is SavedParam => {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.name === 'string' && typeof p.type === 'string' && typeof p.value === 'string'
    && typeof p.isNull === 'boolean' && typeof p.output === 'boolean';
};

/** The stored sets, or an empty store when nothing valid is stored. Never throws. */
export function readParamSets(storage: Pick<Storage, 'getItem'> | undefined): ParamSetStore {
  try {
    const raw = storage?.getItem(PARAM_SET_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const store: ParamSetStore = {};
    for (const [proc, sets] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof sets !== 'object' || sets === null) continue;
      store[proc] = {};
      for (const [setName, params] of Object.entries(sets as Record<string, unknown>)) {
        if (Array.isArray(params) && params.every(isSavedParam)) store[proc][setName] = params;
      }
    }
    return store;
  } catch {
    return {};
  }
}

/** Writes the store. Returns false when the browser refuses the write. */
export function writeParamSets(storage: Pick<Storage, 'setItem'> | undefined, store: ParamSetStore): boolean {
  try {
    storage?.setItem(PARAM_SET_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function setNamesFor(store: ParamSetStore, procedure: string): string[] {
  return Object.keys(store[procedure] ?? {}).sort();
}

export function withSet(store: ParamSetStore, procedure: string, setName: string, params: SavedParam[]): ParamSetStore {
  return { ...store, [procedure]: { ...(store[procedure] ?? {}), [setName]: params } };
}

export function withoutSet(store: ParamSetStore, procedure: string, setName: string): ParamSetStore {
  const rest = { ...(store[procedure] ?? {}) };
  delete rest[setName];
  return { ...store, [procedure]: rest };
}
