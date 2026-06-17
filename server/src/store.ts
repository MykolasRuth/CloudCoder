import fs from 'node:fs';

// Tiny throttled JSON-file store (AgentHub save() pattern).
export function createStore<T>(file: string, initial: T): { data: T; save: () => void } {
  let data = initial;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        fs.writeFileSync(file, JSON.stringify(store.data, null, 2));
      } catch (e: any) {
        console.error('store save failed:', e.message);
      }
    }, 300);
  };
  const store = { data, save };
  return store;
}
