const transactions = new Map<string, Promise<unknown>>();

/** Serialize the complete read/modify/write operation, including separate instances. */
export function serializeStorage<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = transactions.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  transactions.set(key, current);
  const cleanup = () => { if (transactions.get(key) === current) transactions.delete(key); };
  void current.then(cleanup, cleanup);
  return current;
}
