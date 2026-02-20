/**
 * Heuristic token estimation.
 *
 * Average English text is roughly 4 characters per token.
 * Code and structured content (JSON, XML) tend toward 3 characters per token
 * because of short identifiers, brackets, and punctuation.
 *
 * This estimator detects structural content and adjusts accordingly.
 * It intentionally leans toward slight over-estimation (fewer chars/token)
 * so the budget is never accidentally exceeded.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  const len = text.length;

  // Count structural characters that indicate code/JSON
  let structural = 0;
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    // { } [ ] ( ) < > ; = : , " '
    if (
      c === 123 || c === 125 || // { }
      c === 91 || c === 93 ||   // [ ]
      c === 40 || c === 41 ||   // ( )
      c === 60 || c === 62 ||   // < >
      c === 59 || c === 61 ||   // ; =
      c === 58 || c === 44 ||   // : ,
      c === 34 || c === 39      // " '
    ) {
      structural++;
    }
  }

  // If >10% structural characters, use tighter ratio (3 chars/token)
  const charsPerToken = structural / len > 0.1 ? 3 : 4;
  return Math.ceil(len / charsPerToken);
}
