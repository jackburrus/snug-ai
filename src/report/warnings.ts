import type { PackedItem, DroppedItem, Warning } from '../types';

/** Detect actionable warnings from packing decisions. */
export function detectWarnings(
  included: PackedItem[],
  dropped: DroppedItem[],
  budget: number,
): Warning[] {
  const warnings: Warning[] = [];

  // --- Required items exceed budget ---
  const requiredTokens = included
    .filter(i => i.score === Infinity)
    .reduce((sum, i) => sum + i.tokens, 0);

  if (requiredTokens > budget) {
    warnings.push({
      type: 'budget-exceeded',
      message: `Required items alone use ${requiredTokens} tokens, exceeding the ${budget} token budget by ${requiredTokens - budget} tokens.`,
    });
  }

  // --- Lost in the middle ---
  const totalItems = included.length;
  if (totalItems >= 5) {
    const middleStart = Math.floor(totalItems * 0.3);
    const middleEnd = Math.ceil(totalItems * 0.7);
    const middleItems = included.slice(middleStart, middleEnd);
    const highScoreInMiddle = middleItems.filter(
      i => i.score !== Infinity && i.score >= 80,
    );
    if (highScoreInMiddle.length > 0) {
      warnings.push({
        type: 'lost-in-middle',
        message: `${highScoreInMiddle.length} high-relevance item(s) placed in the middle 40% of context where LLM attention is weakest.`,
      });
    }
  }

  // --- Tool overload ---
  const toolCount = included.filter(i => i.source === 'tools').length;
  if (toolCount > 10) {
    warnings.push({
      type: 'tool-overload',
      message: `${toolCount} tool definitions included. Research suggests performance degrades beyond 10 tools — consider reducing.`,
    });
  }

  // --- High drop rate ---
  const totalDropped = dropped.length;
  const totalConsidered = included.length + totalDropped;
  if (totalConsidered > 0 && totalDropped / totalConsidered > 0.5) {
    warnings.push({
      type: 'high-drop-rate',
      message: `${totalDropped} of ${totalConsidered} items (${Math.round((totalDropped / totalConsidered) * 100)}%) were dropped. Consider increasing the budget or reducing context sources.`,
    });
  }

  // --- Low utilization ---
  const totalTokens = included.reduce((sum, i) => sum + i.tokens, 0);
  if (budget > 0 && totalTokens / budget < 0.1 && totalDropped === 0) {
    warnings.push({
      type: 'low-utilization',
      message: `Only ${Math.round((totalTokens / budget) * 100)}% of the token budget is used. The context window may be larger than needed.`,
    });
  }

  return warnings;
}
