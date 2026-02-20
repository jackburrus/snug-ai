import type { Priority } from '../types';

const PRIORITY_SCORES: Record<Priority, number> = {
  required: Infinity,
  high: 100,
  medium: 50,
  low: 10,
};

/** Map a priority tier to a numeric base score. */
export function scorePriority(priority: Priority): number {
  return PRIORITY_SCORES[priority];
}
