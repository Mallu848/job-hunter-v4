// Model pricing constants (USD per million tokens). Keep in one place so the
// ai_usage cost meter (future billing) has a single source of truth.

export const PRICING = {
  'claude-haiku-4-5': { inputPerM: 1.0, outputPerM: 5.0 },
};

export function costUsd(model, inputTokens, outputTokens) {
  const p = PRICING[model];
  if (!p) return 0;
  const cost = (inputTokens / 1e6) * p.inputPerM + (outputTokens / 1e6) * p.outputPerM;
  return Number(cost.toFixed(6));
}
