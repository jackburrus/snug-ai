import type { ContextItem, PackedItem, Placement } from '../types';

/**
 * Position-aware placement based on "Lost in the Middle" research.
 *
 * LLMs attend most to the beginning and end of the context window.
 * This function arranges items to exploit that:
 *
 * - **System prompt** → always first (primacy)
 * - **Query** → always last (recency)
 * - **History** → near the end, in original order (recency + temporal coherence)
 * - **Everything else** (tools, memory, RAG) → edges-first placement:
 *   highest-scored items alternate between beginning and end positions,
 *   pushing lower-scored items toward the middle.
 */
export function applyPlacement(items: ContextItem[]): PackedItem[] {
  const system: ContextItem[] = [];
  const query: ContextItem[] = [];
  const history: ContextItem[] = [];
  const rest: ContextItem[] = [];

  for (const item of items) {
    if (item.source === 'system') system.push(item);
    else if (item.source === 'query') query.push(item);
    else if (item.source === 'history') history.push(item);
    else rest.push(item);
  }

  // Sort history by original index (preserve temporal order)
  history.sort((a, b) => a.index - b.index);

  // Sort rest by score descending for edges-first placement
  rest.sort((a, b) => b.score - a.score);

  // Edges-first: alternate between beginning and pre-history positions
  const beginning: ContextItem[] = [];
  const middle: ContextItem[] = [];

  for (let i = 0; i < rest.length; i++) {
    if (i % 2 === 0) {
      beginning.push(rest[i]!);
    } else {
      middle.push(rest[i]!);
    }
  }
  // Reverse middle so lower-scored items are toward the center
  middle.reverse();

  const result: PackedItem[] = [];

  const push = (arr: ContextItem[], placement: Placement) => {
    for (const item of arr) {
      result.push({
        id: item.id,
        source: item.source,
        content: item.content,
        value: item.value,
        tokens: item.tokens,
        score: item.score,
        placement,
      });
    }
  };

  push(system, 'beginning');
  push(beginning, 'beginning');
  push(middle, 'middle');
  push(history, 'end');
  push(query, 'end');

  return result;
}
