# snug

Fit the right context into your LLM's window.

```
npm install snug
```

snug takes everything you want in your LLM's context — system prompts, tools, conversation history, memory, RAG chunks — and packs it into an optimally arranged context window with full visibility into what was included, what was dropped, and why.

## Why

Every token in your context window costs attention. Research shows:

- **Lost in the Middle** (Liu et al., TACL 2024): LLM performance follows a U-shaped curve. Information at the beginning and end of context is used well; the middle is effectively ignored. Performance degrades 30%+ based purely on *position*.
- **Context Distraction** (Gemini 2.5 tech report): Beyond ~100K tokens, models over-focus on context and neglect training knowledge.
- **Tool Overload** (Berkeley Function-Calling Leaderboard): Every model performs worse with more tools. A quantized Llama 3.1 8b failed with 46 tools but succeeded with 19.
- **Context Clash** (Microsoft/Salesforce): Information gathered over multiple turns caused a 39% average performance drop; o3 dropped from 98.1 to 64.1.

Bigger context windows don't solve this. The problem is architectural. snug helps you pack smarter.

## Quick Start

```typescript
import { ContextOptimizer } from 'snug';

const optimizer = new ContextOptimizer({
  model: 'claude-sonnet-4-20250514',
  contextWindow: 200_000,
  reserveOutput: 8_192,
});

// Register your context sources
optimizer.add('system', 'You are a helpful coding assistant.', {
  priority: 'required',
});

optimizer.add('tools', [
  { name: 'read_file', description: 'Read a file', parameters: { path: { type: 'string' } } },
  { name: 'search', description: 'Search code', parameters: { query: { type: 'string' } } },
], { priority: 'high' });

optimizer.add('history', conversationMessages, {
  priority: 'high',
  keepLast: 3,
});

optimizer.add('memory', memoryResults, { priority: 'medium' });
optimizer.add('rag', ragChunks, { priority: 'medium' });

// Pack for a specific query
const result = optimizer.pack('Update the auth middleware to use JWT');

result.items;    // Ordered context blocks, ready to use
result.stats;    // Token counts, cost estimate, per-source breakdown
result.warnings; // Actionable alerts (lost-in-middle, tool overload, etc.)
result.dropped;  // What was excluded and why
```

## What It Does

snug runs five stages on every `pack()` call:

**1. Measure** — Count tokens per item using a built-in heuristic (~4 chars/token for English, ~3 chars/token for code/JSON). Bring your own tokenizer for exact counts.

**2. Score** — Assign relevance scores. Required items get `Infinity`. High/medium/low tiers get base scores. History items are decayed by recency (oldest messages score lowest). You can pass a custom scorer for domain-specific relevance.

**3. Pack** — Greedy knapsack optimization. Required items go in first. Remaining budget is filled by score, highest first. Items that don't fit are recorded with reasons.

**4. Place** — Position-aware arrangement based on "Lost in the Middle" research. System prompt at the beginning (primacy). Recent history and query at the end (recency). High-scoring items at the edges. Low-scoring items in the middle where attention is weakest.

**5. Report** — Full visibility into the packing decision:

```typescript
result.stats = {
  totalTokens: 47832,
  budget: 191808,
  utilization: 0.249,
  estimatedCost: { input: '$0.1435', provider: 'anthropic' },
  breakdown: {
    system: { tokens: 12, items: 1 },
    tools: { tokens: 156, items: 2, dropped: 1, reason: 'budget exhausted' },
    history: { tokens: 8420, items: 6, dropped: 14 },
    memory: { tokens: 2100, items: 3 },
    rag: { tokens: 36800, items: 8, dropped: 4, reason: 'budget exhausted' },
    query: { tokens: 344, items: 1 },
  },
}
```

## API

### `new ContextOptimizer(config)`

```typescript
const optimizer = new ContextOptimizer({
  model: 'claude-sonnet-4-20250514', // Used for cost estimation
  contextWindow: 200_000,             // Total tokens available
  reserveOutput: 8_192,               // Reserved for model output (default: 4096)
  tokenizer: myTokenizer,             // Optional: { count(text: string): number }
});
```

### `optimizer.add(source, content, options)`

Register a context source. Arrays are split into independently-scored items. Objects are JSON-stringified. Calling `add()` with the same source name replaces the previous registration.

```typescript
optimizer.add('system', systemPrompt, { priority: 'required' });
optimizer.add('tools', toolDefinitions, { priority: 'high' });
optimizer.add('history', messages, { priority: 'high', keepLast: 3 });
optimizer.add('memory', memoryResults, { priority: 'medium' });
optimizer.add('rag', ragChunks, { priority: 'medium' });
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `priority` | `'required' \| 'high' \| 'medium' \| 'low'` | Priority tier. Required items are always included. |
| `keepLast` | `number` | Promote the last N items to required (useful for recent history). |
| `scorer` | `(item, query) => number` | Custom scoring function. Overrides priority-based scoring. |
| `requires` | `Record<string, string>` | Dependency constraints: if item A is included, item B must be too. |
| `dropStrategy` | `'relevance' \| 'oldest' \| 'none'` | How to handle items that don't fit. |
| `compressStrategy` | `'truncate' \| 'summarize-oldest' \| 'none'` | How to compress items. |

### `optimizer.pack(query?)`

Pack all registered sources into an optimized context. The optional query string is included as a required item at the end and used for custom scorers.

Returns `PackResult`:

```typescript
interface PackResult {
  items: PackedItem[];     // Ordered items that fit
  stats: Stats;            // Token counts, cost, breakdown
  warnings: Warning[];     // Actionable alerts
  dropped: DroppedItem[];  // What was excluded
}
```

### `optimizer.remove(source)` / `optimizer.clear()`

Remove a single source or clear all sources.

## Features

### Priority Tiers

Items are scored by tier: `required` (always included) > `high` (100) > `medium` (50) > `low` (10). Within a tier, items compete on score for remaining budget.

### Recency Bias

History sources automatically apply recency weighting. Oldest messages are decayed to 10% of their base score; newest messages retain full score. Combined with `keepLast`, this ensures recent conversation is preserved while old messages are dropped first when budget is tight.

### Lost-in-the-Middle Placement

After packing, items are rearranged to exploit the U-shaped attention curve:
- System prompt and high-scoring items at the **beginning**
- Recent history and the query at the **end**
- Lower-scoring items in the **middle**

### Dependency Constraints

Ensure related items are co-included:

```typescript
optimizer.add('tools', tools, {
  priority: 'high',
  requires: { 'tools_search': 'examples_search_demo' },
});

optimizer.add('examples', examples, { priority: 'low' });
```

If `tools_search` is included but `examples_search_demo` can't fit, the tool is removed instead of shipping without its example.

### Custom Scoring

Override the default priority-based scoring with domain-specific logic:

```typescript
optimizer.add('rag', ragChunks, {
  priority: 'medium',
  scorer: (item, query) => cosineSimilarity(embed(item.content), embed(query)),
});
```

### Warnings

snug detects common context engineering mistakes:

| Warning | Trigger |
|---------|---------|
| `budget-exceeded` | Required items alone exceed the token budget |
| `lost-in-middle` | High-relevance items placed in the middle 40% of context |
| `tool-overload` | More than 10 tool definitions (research shows degradation) |
| `high-drop-rate` | More than 50% of items were dropped |
| `low-utilization` | Less than 10% of budget used with nothing dropped |

### Cost Estimation

Built-in pricing for Anthropic, OpenAI, and Google models. Returns estimated input cost per `pack()` call.

### Custom Tokenizer

The built-in heuristic is fast but approximate. For exact counts, bring your own tokenizer:

```typescript
import { encoding_for_model } from 'tiktoken';

const enc = encoding_for_model('gpt-4o');
const optimizer = new ContextOptimizer({
  model: 'gpt-4o',
  contextWindow: 128_000,
  tokenizer: { count: (text) => enc.encode(text).length },
});
```

## Item IDs

Objects with `name` or `id` fields get human-readable item IDs:

```typescript
optimizer.add('tools', [{ name: 'search', ... }], { priority: 'high' });
// Item ID: "tools_search"
```

This makes the `dropped` array and stats breakdown easy to understand at a glance.

## Zero Dependencies

snug has zero runtime dependencies. The built-in token estimator, priority scorer, greedy packer, and placement optimizer are all self-contained. Optional integrations (custom tokenizers, embedding-based scoring) are bring-your-own.

## License

MIT
