import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Search-history helpers — the native twin of the web's
 * frontend/src/components/home/search-history.ts (R136): the same storage
 * key, cap (8) and dedupe-order semantics, backed by AsyncStorage instead
 * of localStorage. History is written ONLY on an explicitly committed
 * search (submit) — never per keystroke (the R94-A1 #16 contract).
 */

const SEARCH_HISTORY_KEY = "subnation_search_history";
const MAX_SEARCH_HISTORY = 8;

export async function getSearchHistory(): Promise<string[]> {
  try {
    const saved = await AsyncStorage.getItem(SEARCH_HISTORY_KEY);
    return saved ? (JSON.parse(saved) as string[]) : [];
  } catch {
    return [];
  }
}

/** Commit a search to the history (most-recent first, deduped, capped at 8). */
export async function saveSearchHistory(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed) return getSearchHistory();
  const history = await getSearchHistory();
  const filtered = history.filter((h) => h !== trimmed);
  filtered.unshift(trimmed);
  if (filtered.length > MAX_SEARCH_HISTORY) filtered.length = MAX_SEARCH_HISTORY;
  try {
    await AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(filtered));
  } catch {
    // Quota failures degrade to the in-memory list.
  }
  return filtered;
}

export async function clearSearchHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SEARCH_HISTORY_KEY);
  } catch {
    // Removing a missing key is a no-op; storage failures stay silent.
  }
}
