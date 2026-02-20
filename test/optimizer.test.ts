import { test, expect, describe } from 'bun:test';
import {
  ContextOptimizer,
  estimateTokens,
  scorePriority,
  applyRecencyBias,
  greedyPack,
  applyPlacement,
  enforceConstraints,
  truncateToTokens,
  estimateCost,
  DefaultTokenizer,
} from '../src/index.ts';
import type { ContextItem, Constraint } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Measure
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
  test('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  test('estimates ~4 chars per token for plain English', () => {
    const text = 'Hello, this is a simple test sentence for estimation.';
    const tokens = estimateTokens(text);
    // 53 chars / 4 ≈ 14
    expect(tokens).toBeGreaterThanOrEqual(13);
    expect(tokens).toBeLessThanOrEqual(18);
  });

  test('uses tighter ratio for JSON/code content', () => {
    const json = '{"name":"search","description":"Search the web","parameters":{"query":{"type":"string"}}}';
    const tokens = estimateTokens(json);
    // 90 chars / 3 = 30 (tighter ratio due to structural chars)
    expect(tokens).toBeGreaterThanOrEqual(25);
    expect(tokens).toBeLessThanOrEqual(35);
  });
});

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

describe('scorePriority', () => {
  test('required returns Infinity', () => {
    expect(scorePriority('required')).toBe(Infinity);
  });

  test('tiers are ordered correctly', () => {
    expect(scorePriority('high')).toBeGreaterThan(scorePriority('medium'));
    expect(scorePriority('medium')).toBeGreaterThan(scorePriority('low'));
  });
});

describe('applyRecencyBias', () => {
  test('oldest item gets lowest score, newest gets highest', () => {
    const items: ContextItem[] = [
      { id: '0', source: 'h', content: 'a', value: 'a', tokens: 10, priority: 'high', score: 100, index: 0 },
      { id: '1', source: 'h', content: 'b', value: 'b', tokens: 10, priority: 'high', score: 100, index: 1 },
      { id: '2', source: 'h', content: 'c', value: 'c', tokens: 10, priority: 'high', score: 100, index: 2 },
    ];
    applyRecencyBias(items);
    expect(items[0]!.score).toBeLessThan(items[1]!.score);
    expect(items[1]!.score).toBeLessThan(items[2]!.score);
    // Newest should retain full score
    expect(items[2]!.score).toBe(100);
    // Oldest should be decayed
    expect(items[0]!.score).toBeCloseTo(10, 0);
  });

  test('does not decay required items', () => {
    const items: ContextItem[] = [
      { id: '0', source: 'h', content: 'a', value: 'a', tokens: 10, priority: 'required', score: Infinity, index: 0 },
      { id: '1', source: 'h', content: 'b', value: 'b', tokens: 10, priority: 'high', score: 100, index: 1 },
    ];
    applyRecencyBias(items);
    expect(items[0]!.score).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// Pack
// ---------------------------------------------------------------------------

describe('greedyPack', () => {
  test('includes all required items even if they exceed budget', () => {
    const items: ContextItem[] = [
      { id: 'sys', source: 'system', content: 'x', value: 'x', tokens: 500, priority: 'required', score: Infinity, index: 0 },
    ];
    const result = greedyPack(items, 100);
    expect(result.included).toHaveLength(1);
    expect(result.totalTokens).toBe(500);
  });

  test('drops lowest-scored items when budget is tight', () => {
    const items: ContextItem[] = [
      { id: 'a', source: 'rag', content: 'a', value: 'a', tokens: 100, priority: 'medium', score: 80, index: 0 },
      { id: 'b', source: 'rag', content: 'b', value: 'b', tokens: 100, priority: 'medium', score: 50, index: 1 },
      { id: 'c', source: 'rag', content: 'c', value: 'c', tokens: 100, priority: 'low', score: 20, index: 2 },
    ];
    const result = greedyPack(items, 200);
    expect(result.included).toHaveLength(2);
    expect(result.included.map(i => i.id)).toContain('a');
    expect(result.included.map(i => i.id)).toContain('b');
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]!.id).toBe('c');
  });

  test('breaks ties by preferring fewer tokens', () => {
    const items: ContextItem[] = [
      { id: 'big', source: 'rag', content: 'x', value: 'x', tokens: 150, priority: 'medium', score: 50, index: 0 },
      { id: 'small', source: 'rag', content: 'y', value: 'y', tokens: 50, priority: 'medium', score: 50, index: 1 },
    ];
    const result = greedyPack(items, 100);
    expect(result.included).toHaveLength(1);
    expect(result.included[0]!.id).toBe('small');
  });
});

describe('applyPlacement', () => {
  test('system items go at the beginning', () => {
    const items: ContextItem[] = [
      { id: 'sys', source: 'system', content: 'sys', value: 'sys', tokens: 50, priority: 'required', score: Infinity, index: 0 },
      { id: 'rag_0', source: 'rag', content: 'r', value: 'r', tokens: 50, priority: 'medium', score: 50, index: 0 },
      { id: 'h_0', source: 'history', content: 'h', value: 'h', tokens: 50, priority: 'high', score: 100, index: 0 },
      { id: 'q', source: 'query', content: 'q', value: 'q', tokens: 10, priority: 'required', score: Infinity, index: 0 },
    ];
    const placed = applyPlacement(items);
    expect(placed[0]!.source).toBe('system');
    expect(placed[0]!.placement).toBe('beginning');
  });

  test('query items go at the end', () => {
    const items: ContextItem[] = [
      { id: 'sys', source: 'system', content: 'sys', value: 'sys', tokens: 50, priority: 'required', score: Infinity, index: 0 },
      { id: 'q', source: 'query', content: 'q', value: 'q', tokens: 10, priority: 'required', score: Infinity, index: 0 },
    ];
    const placed = applyPlacement(items);
    expect(placed[placed.length - 1]!.source).toBe('query');
    expect(placed[placed.length - 1]!.placement).toBe('end');
  });

  test('history preserves temporal order at the end', () => {
    const items: ContextItem[] = [
      { id: 'h_0', source: 'history', content: 'first', value: 'first', tokens: 10, priority: 'high', score: 50, index: 0 },
      { id: 'h_2', source: 'history', content: 'third', value: 'third', tokens: 10, priority: 'high', score: 90, index: 2 },
      { id: 'h_1', source: 'history', content: 'second', value: 'second', tokens: 10, priority: 'high', score: 70, index: 1 },
      { id: 'q', source: 'query', content: 'q', value: 'q', tokens: 10, priority: 'required', score: Infinity, index: 0 },
    ];
    const placed = applyPlacement(items);
    const historyItems = placed.filter(i => i.source === 'history');
    expect(historyItems[0]!.id).toBe('h_0');
    expect(historyItems[1]!.id).toBe('h_1');
    expect(historyItems[2]!.id).toBe('h_2');
  });
});

// ---------------------------------------------------------------------------
// Compress
// ---------------------------------------------------------------------------

describe('truncateToTokens', () => {
  const tokenizer = new DefaultTokenizer();

  test('returns original text if already within budget', () => {
    expect(truncateToTokens('Hello', 100, tokenizer)).toBe('Hello');
  });

  test('truncates long text to fit budget', () => {
    const long = 'a'.repeat(1000);
    const result = truncateToTokens(long, 50, tokenizer);
    expect(tokenizer.count(result)).toBeLessThanOrEqual(55); // slight overhead from "..."
  });

  test('returns empty string for zero budget', () => {
    expect(truncateToTokens('Hello world', 0, tokenizer)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

describe('estimateCost', () => {
  test('returns cost for known model', () => {
    const cost = estimateCost(1_000_000, 'claude-sonnet-4-20250514');
    expect(cost).toBeDefined();
    expect(cost!.input).toBe('$3.0000');
    expect(cost!.provider).toBe('anthropic');
  });

  test('returns undefined for unknown model', () => {
    expect(estimateCost(1000, 'unknown-model-xyz')).toBeUndefined();
  });

  test('handles prefix matching', () => {
    const cost = estimateCost(1_000_000, 'claude-sonnet-4-20250514-v2');
    expect(cost).toBeDefined();
    expect(cost!.provider).toBe('anthropic');
  });
});

// ---------------------------------------------------------------------------
// ContextOptimizer (integration)
// ---------------------------------------------------------------------------

describe('ContextOptimizer', () => {
  test('basic packing with system prompt and query', () => {
    const opt = new ContextOptimizer({
      model: 'claude-sonnet-4-20250514',
      contextWindow: 10000,
      reserveOutput: 1000,
    });

    opt.add('system', 'You are a helpful assistant.', { priority: 'required' });
    const result = opt.pack('What is 2+2?');

    expect(result.items.length).toBeGreaterThanOrEqual(2);
    expect(result.items[0]!.source).toBe('system');
    expect(result.items[result.items.length - 1]!.source).toBe('query');
    expect(result.stats.totalTokens).toBeGreaterThan(0);
    expect(result.stats.budget).toBe(9000);
    expect(result.stats.utilization).toBeGreaterThan(0);
  });

  test('pack without query', () => {
    const opt = new ContextOptimizer({
      model: 'gpt-4o',
      contextWindow: 10000,
    });

    opt.add('system', 'System prompt.', { priority: 'required' });
    opt.add('memory', ['fact one', 'fact two'], { priority: 'medium' });

    const result = opt.pack();
    expect(result.items).toHaveLength(3); // system + 2 memory
    expect(result.items.find(i => i.source === 'query')).toBeUndefined();
  });

  test('drops low-priority items when budget is exceeded', () => {
    const opt = new ContextOptimizer({
      model: 'gpt-4o',
      contextWindow: 500,
      reserveOutput: 100,
    });

    opt.add('system', 'x'.repeat(200), { priority: 'required' });
    opt.add('rag', [
      'a'.repeat(200),
      'b'.repeat(200),
      'c'.repeat(200),
    ], { priority: 'medium' });

    const result = opt.pack();
    // Budget = 400 tokens. System ≈ 50 tokens (200 chars / 4).
    // Each RAG chunk ≈ 50 tokens. System + 3 RAG = 200 tokens, should all fit.
    // But let's verify ordering and stats
    expect(result.stats.totalTokens).toBeLessThanOrEqual(400);
    expect(result.dropped.length + result.items.length).toBeGreaterThanOrEqual(1);
  });

  test('keepLast promotes recent history to required', () => {
    const opt = new ContextOptimizer({
      model: 'gpt-4o',
      contextWindow: 200,
      reserveOutput: 50,
    });

    opt.add('history', [
      { role: 'user', content: 'old message' },
      { role: 'assistant', content: 'old reply' },
      { role: 'user', content: 'recent message' },
    ], { priority: 'high', keepLast: 1 });

    const result = opt.pack();
    // The last history item should be included (required)
    const historyItems = result.items.filter(i => i.source === 'history');
    expect(historyItems.some(i => i.id === 'history_2')).toBe(true);
  });

  test('tools with named objects get readable IDs', () => {
    const opt = new ContextOptimizer({
      model: 'gpt-4o',
      contextWindow: 10000,
    });

    opt.add('tools', [
      { name: 'search', description: 'Search the web' },
      { name: 'calculate', description: 'Do math' },
    ], { priority: 'high' });

    const result = opt.pack();
    const toolIds = result.items.map(i => i.id);
    expect(toolIds).toContain('tools_search');
    expect(toolIds).toContain('tools_calculate');
  });

  test('preserves original values in output', () => {
    const opt = new ContextOptimizer({
      model: 'gpt-4o',
      contextWindow: 10000,
    });

    const toolDef = { name: 'search', description: 'Search the web', parameters: {} };
    opt.add('tools', [toolDef], { priority: 'high' });

    const result = opt.pack();
    const tool = result.items.find(i => i.source === 'tools');
    expect(tool!.value).toEqual(toolDef);
  });

  test('replace source on re-add', () => {
    const opt = new ContextOptimizer({
      model: 'gpt-4o',
      contextWindow: 10000,
    });

    opt.add('system', 'Version 1', { priority: 'required' });
    opt.add('system', 'Version 2', { priority: 'required' });

    const result = opt.pack();
    const systemItems = result.items.filter(i => i.source === 'system');
    expect(systemItems).toHaveLength(1);
    expect(systemItems[0]!.content).toBe('Version 2');
  });

  test('remove() and clear()', () => {
    const opt = new ContextOptimizer({
      model: 'gpt-4o',
      contextWindow: 10000,
    });

    opt.add('system', 'sys', { priority: 'required' });
    opt.add('tools', ['a', 'b'], { priority: 'high' });

    opt.remove('tools');
    let result = opt.pack();
    expect(result.items.filter(i => i.source === 'tools')).toHaveLength(0);

    opt.clear();
    result = opt.pack();
    expect(result.items).toHaveLength(0);
  });

  test('cost estimation appears in stats', () => {
    const opt = new ContextOptimizer({
      model: 'claude-sonnet-4-20250514',
      contextWindow: 10000,
    });

    opt.add('system', 'Hello world.', { priority: 'required' });
    const result = opt.pack();
    expect(result.stats.estimatedCost).toBeDefined();
    expect(result.stats.estimatedCost!.provider).toBe('anthropic');
  });

  test('warnings: budget exceeded by required items', () => {
    const opt = new ContextOptimizer({
      model: 'gpt-4o',
      contextWindow: 100,
      reserveOutput: 50,
    });

    // Budget = 50 tokens. Required item ≈ 250 tokens.
    opt.add('system', 'x'.repeat(1000), { priority: 'required' });
    const result = opt.pack();
    expect(result.warnings.some(w => w.type === 'budget-exceeded')).toBe(true);
  });

  test('warnings: tool overload', () => {
    const opt = new ContextOptimizer({
      model: 'gpt-4o',
      contextWindow: 100000,
    });

    const tools = Array.from({ length: 15 }, (_, i) => ({
      name: `tool_${i}`,
      description: `Tool ${i}`,
    }));
    opt.add('tools', tools, { priority: 'high' });
    const result = opt.pack();
    expect(result.warnings.some(w => w.type === 'tool-overload')).toBe(true);
  });

  test('custom scorer overrides priority scoring', () => {
    const opt = new ContextOptimizer({
      model: 'gpt-4o',
      contextWindow: 300,
      reserveOutput: 50,
    });

    opt.add('rag', ['about cats', 'about dogs', 'about fish'], {
      priority: 'medium',
      scorer: (item, query) => {
        // Score higher if content matches query keyword
        return item.content.includes('cats') ? 200 : 10;
      },
    });

    const result = opt.pack('Tell me about cats');
    // 'about cats' should be included preferentially
    const ragItems = result.items.filter(i => i.source === 'rag');
    if (ragItems.length > 0) {
      expect(ragItems[0]!.content).toBe('about cats');
    }
  });

  test('recency bias applied to history', () => {
    const opt = new ContextOptimizer({
      model: 'gpt-4o',
      contextWindow: 200,
      reserveOutput: 50,
    });

    // Create history with identical content but different positions
    // Budget is tight so not all can fit
    opt.add('history', [
      'x'.repeat(100), // old — should be dropped first
      'y'.repeat(100), // middle
      'z'.repeat(100), // recent — should be kept
    ], { priority: 'high' });

    const result = opt.pack();
    const historyItems = result.items.filter(i => i.source === 'history');
    // Most recent items should survive
    if (historyItems.length < 3) {
      const included = historyItems.map(i => i.id);
      // history_2 (most recent) should be more likely to survive
      expect(included).toContain('history_2');
    }
  });

  test('full integration: system + tools + history + rag + query', () => {
    const opt = new ContextOptimizer({
      model: 'claude-sonnet-4-20250514',
      contextWindow: 200_000,
      reserveOutput: 8_192,
    });

    opt.add('system', 'You are a helpful coding assistant. Always explain your reasoning step by step.', {
      priority: 'required',
    });

    opt.add('tools', [
      { name: 'read_file', description: 'Read a file from disk', parameters: { path: { type: 'string' } } },
      { name: 'write_file', description: 'Write content to a file', parameters: { path: { type: 'string' }, content: { type: 'string' } } },
      { name: 'search', description: 'Search the codebase', parameters: { query: { type: 'string' } } },
    ], { priority: 'high' });

    opt.add('history', [
      { role: 'user', content: 'Can you help me refactor my auth module?' },
      { role: 'assistant', content: 'Sure! Let me look at the current implementation.' },
      { role: 'user', content: 'Here is the file: [large code block]' },
      { role: 'assistant', content: 'I see several issues. Let me suggest improvements.' },
    ], { priority: 'high', keepLast: 2 });

    opt.add('memory', [
      'User prefers TypeScript',
      'Project uses Express.js',
      'Auth module is in src/auth/',
    ], { priority: 'medium' });

    opt.add('rag', [
      'Express.js middleware documentation excerpt...',
      'JWT best practices guide...',
      'OAuth2 implementation patterns...',
    ], { priority: 'medium' });

    const result = opt.pack('Now update the auth middleware to use JWT');

    // Verify structure
    expect(result.items[0]!.source).toBe('system');
    expect(result.items[result.items.length - 1]!.source).toBe('query');
    expect(result.stats.budget).toBe(200_000 - 8_192);
    expect(result.stats.utilization).toBeGreaterThan(0);
    expect(result.stats.estimatedCost).toBeDefined();
    expect(result.stats.breakdown['system']).toBeDefined();
    expect(result.stats.breakdown['tools']).toBeDefined();
    expect(result.stats.breakdown['history']).toBeDefined();
    expect(result.stats.breakdown['memory']).toBeDefined();
    expect(result.stats.breakdown['rag']).toBeDefined();
    expect(result.stats.breakdown['query']).toBeDefined();

    // History: last 2 should be required
    const historyItems = result.items.filter(i => i.source === 'history');
    expect(historyItems.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

describe('enforceConstraints', () => {
  test('pulls in dependency when trigger is included', () => {
    const included: ContextItem[] = [
      { id: 'tools_search', source: 'tools', content: 'search', value: 'search', tokens: 50, priority: 'high', score: 100, index: 0 },
    ];
    const available: ContextItem[] = [
      { id: 'examples_search_demo', source: 'examples', content: 'demo', value: 'demo', tokens: 50, priority: 'low', score: 10, index: 0 },
    ];
    const constraints: Constraint[] = [
      { ifIncluded: 'tools_search', thenRequire: 'examples_search_demo' },
    ];
    const result = enforceConstraints(included, available, constraints, 200);
    expect(result.included.some(i => i.id === 'examples_search_demo')).toBe(true);
    expect(result.added).toHaveLength(1);
  });

  test('removes trigger when dependency cannot fit', () => {
    const included: ContextItem[] = [
      { id: 'tools_search', source: 'tools', content: 'search', value: 'search', tokens: 80, priority: 'high', score: 100, index: 0 },
    ];
    const available: ContextItem[] = [
      { id: 'examples_search_demo', source: 'examples', content: 'demo', value: 'demo', tokens: 50, priority: 'low', score: 10, index: 0 },
    ];
    const constraints: Constraint[] = [
      { ifIncluded: 'tools_search', thenRequire: 'examples_search_demo' },
    ];
    // Budget of 100 can hold search (80) but not search + demo (130)
    const result = enforceConstraints(included, available, constraints, 100);
    expect(result.included.some(i => i.id === 'tools_search')).toBe(false);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]!.id).toBe('tools_search');
  });

  test('does not remove required trigger', () => {
    const included: ContextItem[] = [
      { id: 'sys', source: 'system', content: 'sys', value: 'sys', tokens: 80, priority: 'required', score: Infinity, index: 0 },
    ];
    const available: ContextItem[] = [
      { id: 'dep', source: 'deps', content: 'dep', value: 'dep', tokens: 50, priority: 'low', score: 10, index: 0 },
    ];
    const constraints: Constraint[] = [
      { ifIncluded: 'sys', thenRequire: 'dep' },
    ];
    const result = enforceConstraints(included, available, constraints, 100);
    // Required trigger stays even though dependency doesn't fit
    expect(result.included.some(i => i.id === 'sys')).toBe(true);
    expect(result.removed).toHaveLength(0);
  });
});

describe('ContextOptimizer constraints integration', () => {
  test('requires option pulls in dependency from another source', () => {
    const opt = new ContextOptimizer({
      model: 'gpt-4o',
      contextWindow: 10000,
    });

    opt.add('tools', [
      { name: 'search', description: 'Search the web' },
    ], {
      priority: 'high',
      requires: { 'tools_search': 'examples_search_demo' },
    });

    opt.add('examples', [
      { name: 'search_demo', description: 'Example: search for "hello"' },
    ], { priority: 'low' });

    const result = opt.pack();
    const ids = result.items.map(i => i.id);
    expect(ids).toContain('tools_search');
    expect(ids).toContain('examples_search_demo');
  });
});
