import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Stable anonymous session id used to attribute product views from
 * signed-out users.  Persisted forever in AsyncStorage (and survives app
 * reloads) so the recently-viewed list "follows" the user across sessions
 * until they sign in.
 *
 * The value is opaque — random base-36 + timestamp — so it can't be
 * reverse-engineered into anything PII.
 */
const KEY = "allsale.anon_session_id.v1";
let cached: string | null = null;

export async function getAnonSessionId(): Promise<string> {
  if (cached) return cached;
  try {
    const existing = await AsyncStorage.getItem(KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
  } catch {
    // ignore storage failures (Safari private mode etc.) — generate transient id
  }
  const fresh = `anon_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  try {
    await AsyncStorage.setItem(KEY, fresh);
  } catch {
    // ignore
  }
  cached = fresh;
  return fresh;
}
