import type { Tokenizer } from '../types';
import { estimateTokens } from './heuristic';

/**
 * Default tokenizer using the character-based heuristic.
 * Swap this out by passing a custom `Tokenizer` to `OptimizerConfig`.
 */
export class DefaultTokenizer implements Tokenizer {
  count(text: string): number {
    return estimateTokens(text);
  }
}
