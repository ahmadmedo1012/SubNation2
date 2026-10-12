// R136 (FE-3 decomposition): extracted verbatim from pages/home.tsx —
// the search-history localStorage helpers. Pure functions, ZERO React
// (the buy-intent-key.ts idiom): the page keeps every call site — the
// mount-time read, the commitSearch write and the «مسح» clear — so the
// R94-A1 #16 "history is written ONLY on an explicitly committed
// search" contract keeps its single owner. Key name, cap and dedupe
// order are byte-identical.

// Search history localStorage helpers
const SEARCH_HISTORY_KEY = "subnation_search_history";
const MAX_SEARCH_HISTORY = 8;

export function getSearchHistory(): string[] {
  try {
    const saved = localStorage.getItem(SEARCH_HISTORY_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export function saveSearchHistory(query: string) {
  if (!query.trim()) return;
  const history = getSearchHistory();
  const filtered = history.filter((h) => h !== query);
  filtered.unshift(query);
  if (filtered.length > MAX_SEARCH_HISTORY) filtered.pop();
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(filtered));
}

export function clearSearchHistory() {
  localStorage.removeItem(SEARCH_HISTORY_KEY);
}
