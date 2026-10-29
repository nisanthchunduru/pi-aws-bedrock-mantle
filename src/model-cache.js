import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateMantleModelEntries } from "./discovery.js";

const CACHE_VERSION = 1;
export const MODEL_CACHE_TTL_MS = 5 * 60_000;

function cachePath(config) {
  if (!config.cacheDirectory) return undefined;
  const profileKey = createHash("sha256").update(JSON.stringify(config.profile ?? null)).digest("hex").slice(0, 16);
  return join(config.cacheDirectory, `models-${config.region}-${profileKey}.json`);
}

export function createModelCache(config, now = Date.now) {
  const path = cachePath(config);
  return {
    read: async () => {
      if (!path) return undefined;
      try {
        const cached = JSON.parse(await readFile(path, "utf8"));
        const age = now() - cached.checkedAt;
        if (cached.version !== CACHE_VERSION || cached.region !== config.region || cached.profile !== (config.profile || null)
          || !Number.isSafeInteger(cached.checkedAt) || age < 0 || age >= MODEL_CACHE_TTL_MS) return undefined;
        return { checkedAt: cached.checkedAt, entries: validateMantleModelEntries(cached.entries) };
      } catch {
        return undefined;
      }
    },
    write: async (entries, checkedAt) => {
      if (!path) return;
      const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await mkdir(config.cacheDirectory, { recursive: true, mode: 0o700 });
        await writeFile(temporaryPath, JSON.stringify({
          version: CACHE_VERSION,
          region: config.region,
          profile: config.profile || null,
          checkedAt,
          entries,
        }), { encoding: "utf8", flag: "wx", mode: 0o600 });
        await rename(temporaryPath, path);
      } catch {
        try { await unlink(temporaryPath); } catch {}
      }
    },
  };
}
