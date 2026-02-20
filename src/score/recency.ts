import type { ContextItem } from '../types';

/**
 * Apply recency bias to an ordered list of items.
 *
 * Items closer to the end of the array (most recent) retain more of their
 * score. Items at the beginning (oldest) are decayed down to `minFactor`.
 *
 * Items that are already `required` priority are never decayed.
 */
export function applyRecencyBias(
  items: ContextItem[],
  options: { minFactor?: number } = {},
): void {
  const { minFactor = 0.1 } = options;
  const total = items.length;
  if (total <= 1) return;

  for (let i = 0; i < total; i++) {
    if (items[i]!.priority === 'required') continue;
    // Linear decay: index 0 (oldest) → minFactor, index total-1 (newest) → 1.0
    const factor = minFactor + ((1 - minFactor) * i) / (total - 1);
    items[i]!.score *= factor;
  }
}
