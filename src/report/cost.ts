import type { CostEstimate } from '../types';

interface PricingEntry {
  inputPer1M: number;
  provider: string;
}

/**
 * Pricing data for common models (USD per 1M input tokens).
 * Updated as of early 2026. Users should verify current pricing.
 */
const PRICING: Record<string, PricingEntry> = {
  // Anthropic
  'claude-opus-4-20250514': { inputPer1M: 15, provider: 'anthropic' },
  'claude-sonnet-4-20250514': { inputPer1M: 3, provider: 'anthropic' },
  'claude-sonnet-4-5-20250514': { inputPer1M: 3, provider: 'anthropic' },
  'claude-haiku-3-5-20241022': { inputPer1M: 0.8, provider: 'anthropic' },
  // OpenAI
  'gpt-4o': { inputPer1M: 2.5, provider: 'openai' },
  'gpt-4o-mini': { inputPer1M: 0.15, provider: 'openai' },
  'gpt-4-turbo': { inputPer1M: 10, provider: 'openai' },
  'o1': { inputPer1M: 15, provider: 'openai' },
  'o1-mini': { inputPer1M: 3, provider: 'openai' },
  'o3': { inputPer1M: 10, provider: 'openai' },
  'o3-mini': { inputPer1M: 1.1, provider: 'openai' },
  // Google
  'gemini-2.0-flash': { inputPer1M: 0.1, provider: 'google' },
  'gemini-2.0-pro': { inputPer1M: 1.25, provider: 'google' },
  'gemini-1.5-pro': { inputPer1M: 3.5, provider: 'google' },
  'gemini-1.5-flash': { inputPer1M: 0.075, provider: 'google' },
};

/**
 * Estimate input cost for a given token count and model.
 * Returns undefined if the model isn't in the pricing table.
 */
export function estimateCost(
  tokens: number,
  model: string,
): CostEstimate | undefined {
  // Try exact match first, then prefix match
  const entry =
    PRICING[model] ??
    Object.entries(PRICING).find(([key]) => model.startsWith(key))?.[1];

  if (!entry) return undefined;

  const cost = (tokens / 1_000_000) * entry.inputPer1M;
  return {
    input: `$${cost.toFixed(4)}`,
    provider: entry.provider,
  };
}
