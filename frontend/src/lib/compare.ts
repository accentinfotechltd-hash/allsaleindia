/**
 * Lightweight client-side compare list (max 4 items) backed by AsyncStorage.
 * Surfaced via a tiny event-emitter so other screens can react when the list
 * changes without prop-drilling through a context.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@allsale.compare.v1";
const MAX = 4;

type Listener = (ids: string[]) => void;
const listeners = new Set<Listener>();

async function read(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function write(ids: string[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(ids.slice(0, MAX)));
  listeners.forEach((l) => l(ids));
}

export async function getCompareIds(): Promise<string[]> {
  return read();
}

export async function isInCompare(id: string): Promise<boolean> {
  return (await read()).includes(id);
}

export async function toggleCompare(id: string): Promise<{ added: boolean; ids: string[]; cappedAt?: number }> {
  const cur = await read();
  if (cur.includes(id)) {
    const next = cur.filter((x) => x !== id);
    await write(next);
    return { added: false, ids: next };
  }
  if (cur.length >= MAX) {
    return { added: false, ids: cur, cappedAt: MAX };
  }
  const next = [...cur, id];
  await write(next);
  return { added: true, ids: next };
}

export async function clearCompare(): Promise<void> {
  await write([]);
}

export function subscribeCompare(l: Listener): () => void {
  listeners.add(l);
  // Push initial value asynchronously.
  read().then(l).catch(() => {});
  return () => listeners.delete(l);
}

export const COMPARE_MAX = MAX;
