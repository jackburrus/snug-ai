import type { Tokenizer } from '../types';

/**
 * Truncate text content to fit within a target token count.
 *
 * Uses a binary-search approach to find the longest prefix that fits.
 * Tries to break at word boundaries when possible.
 */
export function truncateToTokens(
  text: string,
  targetTokens: number,
  tokenizer: Tokenizer,
): string {
  if (tokenizer.count(text) <= targetTokens) return text;
  if (targetTokens <= 0) return '';

  // Estimate character position from target tokens (assume ~4 chars/token)
  let hi = text.length;
  let lo = 0;
  let best = 0;

  // Binary search for the longest prefix that fits
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const slice = text.slice(0, mid);
    if (tokenizer.count(slice) <= targetTokens) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  let result = text.slice(0, best);

  // Try to break at last word boundary
  const lastSpace = result.lastIndexOf(' ');
  if (lastSpace > best * 0.8) {
    result = result.slice(0, lastSpace);
  }

  return result + (best < text.length ? '...' : '');
}
