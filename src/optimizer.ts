import type {
  OptimizerConfig,
  AddOptions,
  ContextItem,
  ContextSource,
  PackResult,
  Tokenizer,
} from './types';
import { DefaultTokenizer } from './measure/tokenizer';
import { scorePriority } from './score/priority';
import { applyRecencyBias } from './score/recency';
import { greedyPack } from './pack/greedy';
import { enforceConstraints, type Constraint } from './pack/constraints';
import { applyPlacement } from './pack/placement';
import { buildStats } from './report/stats';
import { detectWarnings } from './report/warnings';

const DEFAULT_RESERVE_OUTPUT = 4096;

export class ContextOptimizer {
  private config: OptimizerConfig;
  private tokenizer: Tokenizer;
  private sources: Map<string, ContextSource> = new Map();

  constructor(config: OptimizerConfig) {
    this.config = config;
    this.tokenizer = config.tokenizer ?? new DefaultTokenizer();
  }

  /**
   * Register a context source.
   *
   * @param source  - Identifier for this source (e.g. 'system', 'tools', 'history')
   * @param content - The content. Strings become one item; arrays become multiple
   *                  independently-scored items. Objects are JSON-stringified.
   * @param options - Priority, drop/compress strategies, etc.
   *
   * Calling `add()` with the same source name replaces the previous registration.
   */
  add(
    source: string,
    content: string | string[] | object | object[],
    options: AddOptions,
  ): this {
    const items = this.normalizeContent(source, content, options);
    this.sources.set(source, { name: source, items, options });
    return this;
  }

  /**
   * Remove a previously registered source.
   */
  remove(source: string): this {
    this.sources.delete(source);
    return this;
  }

  /**
   * Remove all registered sources.
   */
  clear(): this {
    this.sources.clear();
    return this;
  }

  /**
   * Pack the registered context into an optimized arrangement.
   *
   * @param query - Optional user query. Used for relevance scoring (v1+)
   *                and included as a required item at the end of the output.
   * @returns PackResult with ordered items, stats, warnings, and dropped items.
   */
  pack(query?: string): PackResult {
    const budget =
      this.config.contextWindow -
      (this.config.reserveOutput ?? DEFAULT_RESERVE_OUTPUT);

    // Collect and score all items
    const allItems = this.collectAndScore(query);

    // Add query as a required item if provided
    if (query) {
      allItems.push({
        id: 'query_0',
        source: 'query',
        content: query,
        value: query,
        tokens: this.tokenizer.count(query),
        priority: 'required',
        score: Infinity,
        index: 0,
      });
    }

    // Greedy knapsack packing
    const { included, dropped } = greedyPack(allItems, budget);

    // Enforce dependency constraints
    const constraints = this.collectConstraints();
    const { added, removed } = enforceConstraints(
      included,
      dropped.map(d => allItems.find(i => i.id === d.id)!).filter(Boolean),
      constraints,
      budget,
    );

    // Update dropped list: remove items that were added by constraints, add items removed
    const addedIds = new Set(added.map(i => i.id));
    const finalDropped = [
      ...dropped.filter(d => !addedIds.has(d.id)),
      ...removed.map(i => ({
        source: i.source,
        id: i.id,
        tokens: i.tokens,
        score: i.score,
        reason: 'constraint dependency unavailable',
      })),
    ];

    // Position-aware placement (lost-in-the-middle optimization)
    const placed = applyPlacement(included);

    // Build report
    const stats = buildStats(placed, finalDropped, budget, this.config);
    const warnings = detectWarnings(placed, finalDropped, budget);

    return { items: placed, stats, warnings, dropped: finalDropped };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private normalizeContent(
    source: string,
    content: string | string[] | object | object[],
    options: AddOptions,
  ): ContextItem[] {
    const items: ContextItem[] = [];
    const contentArray = Array.isArray(content) ? content : [content];

    for (let i = 0; i < contentArray.length; i++) {
      const raw = contentArray[i]!;
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const itemId = this.deriveItemId(source, raw, i);

      items.push({
        id: itemId,
        source,
        content: text,
        value: raw,
        tokens: this.tokenizer.count(text),
        priority: options.priority,
        score: 0,
        index: i,
      });
    }

    // Promote last N items to 'required' if keepLast is set
    if (options.keepLast != null && options.keepLast > 0) {
      const start = Math.max(0, items.length - options.keepLast);
      for (let i = start; i < items.length; i++) {
        items[i]!.priority = 'required';
      }
    }

    return items;
  }

  private deriveItemId(source: string, raw: unknown, index: number): string {
    // Use name/id field from objects when available for readable IDs
    if (typeof raw === 'object' && raw !== null) {
      const obj = raw as Record<string, unknown>;
      const name = obj['name'] ?? obj['id'];
      if (typeof name === 'string' || typeof name === 'number') {
        return `${source}_${name}`;
      }
    }
    return `${source}_${index}`;
  }

  private collectConstraints(): Constraint[] {
    const constraints: Constraint[] = [];
    for (const [, source] of this.sources) {
      if (!source.options.requires) continue;
      for (const [ifIncluded, thenRequire] of Object.entries(source.options.requires)) {
        constraints.push({ ifIncluded, thenRequire });
      }
    }
    return constraints;
  }

  private collectAndScore(query?: string): ContextItem[] {
    const allItems: ContextItem[] = [];

    for (const [, source] of this.sources) {
      // Assign base score from priority
      for (const item of source.items) {
        item.score = scorePriority(item.priority);
      }

      // Apply recency bias for ordered sources
      if (source.name === 'history' || source.options.compressStrategy === 'summarize-oldest') {
        applyRecencyBias(source.items);
      }

      // Apply custom scorer if provided
      if (source.options.scorer && query) {
        for (const item of source.items) {
          if (item.priority !== 'required') {
            item.score = source.options.scorer(item, query);
          }
        }
      }

      allItems.push(...source.items);
    }

    return allItems;
  }
}
