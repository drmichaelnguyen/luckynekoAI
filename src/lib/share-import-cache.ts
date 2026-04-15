/**
 * In-memory staging for Web Share Target imports.
 *
 * Note: this works reliably on a single long-running Node process (typical `next dev` / many
 * self-hosted setups). Serverless/multi-instance deployments should replace this with shared
 * storage (KV/blob) if you need share imports in production.
 */
export type ShareImportFilePart = {
  base64: string;
  mimeType: string;
  name: string;
};

export type ShareImportPayload = {
  parts: ShareImportFilePart[];
  title?: string;
  text?: string;
  url?: string;
  expires: number;
};

const TTL_MS = 5 * 60 * 1000;
const store = new Map<string, ShareImportPayload>();

function prune() {
  const now = Date.now();
  for (const [key, value] of store) {
    if (value.expires < now) store.delete(key);
  }
}

export function putShareImport(payload: {
  parts: ShareImportFilePart[];
  title?: string;
  text?: string;
  url?: string;
}): string {
  prune();
  const id = crypto.randomUUID();
  store.set(id, {
    ...payload,
    expires: Date.now() + TTL_MS,
  });
  return id;
}

export function getShareImport(id: string): ShareImportPayload | null {
  prune();
  const payload = store.get(id);
  if (!payload) return null;
  if (payload.expires < Date.now()) {
    store.delete(id);
    return null;
  }
  return payload;
}

export function acknowledgeShareImport(id: string): void {
  store.delete(id);
}
