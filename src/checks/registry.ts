import type { CheckDefinition } from '../types.js';
import { CATEGORY_ORDER } from '../constants.js';

const registry: Map<string, CheckDefinition> = new Map();

export function registerCheck(def: CheckDefinition): void {
  registry.set(def.id, def);
}

export function getCheck(id: string): CheckDefinition | undefined {
  return registry.get(id);
}

export function getAllChecks(): CheckDefinition[] {
  return Array.from(registry.values());
}

/** Returns checks sorted by category order, preserving registration order within category. */
export function getChecksSorted(): CheckDefinition[] {
  return getAllChecks().sort((a, b) => {
    const orderA = CATEGORY_ORDER[a.category] ?? 99;
    const orderB = CATEGORY_ORDER[b.category] ?? 99;
    return orderA - orderB;
  });
}
