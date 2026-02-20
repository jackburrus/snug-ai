import type { ContextItem, DroppedItem } from '../types';

export interface PackDecision {
  included: ContextItem[];
  dropped: DroppedItem[];
  totalTokens: number;
}

/**
 * Greedy knapsack packer.
 *
 * 1. Include all required items unconditionally.
 * 2. Sort remaining items by score descending.
 * 3. Greedily add items until the budget is exhausted.
 * 4. Record dropped items with reasons.
 */
export function greedyPack(
  items: ContextItem[],
  budget: number,
): PackDecision {
  const required: ContextItem[] = [];
  const optional: ContextItem[] = [];

  for (const item of items) {
    if (item.priority === 'required') {
      required.push(item);
    } else {
      optional.push(item);
    }
  }

  let totalTokens = 0;
  const included: ContextItem[] = [];
  const dropped: DroppedItem[] = [];

  // Required items always go in — even if they exceed budget
  for (const item of required) {
    totalTokens += item.tokens;
    included.push(item);
  }

  // Sort optional items by score descending, break ties by fewer tokens
  optional.sort((a, b) => b.score - a.score || a.tokens - b.tokens);

  for (const item of optional) {
    if (totalTokens + item.tokens <= budget) {
      totalTokens += item.tokens;
      included.push(item);
    } else {
      dropped.push({
        source: item.source,
        id: item.id,
        tokens: item.tokens,
        score: item.score,
        reason: 'budget exhausted',
      });
    }
  }

  return { included, dropped, totalTokens };
}
