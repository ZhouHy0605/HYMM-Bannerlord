// Apply only to browser responses. Stored worlds, matchmaking and bridge
// payloads retain their ratings; combat scores are not rating points.
const privateKeys = new Set(['rating', 'rank', 'ratings', 'changes', 'ratingBreakdown', 'ratingRule']);
export function ratingVisibility(view) {
  if (view.isAdmin === true) return view;
  function redact(value) {
    if (Array.isArray(value)) return value.map(redact);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !privateKeys.has(key))
      .map(([key, child]) => [key, key === 'ledger' || key === 'leaderboard' ? [] : redact(child)]));
  }
  return redact(view);
}
