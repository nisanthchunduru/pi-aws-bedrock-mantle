import { createCredentials } from "./credentials.js";
import { listMantleModels } from "./discovery.js";
import { createModelCache, MODEL_CACHE_TTL_MS } from "./model-cache.js";
import { mapMantleModels, PROVIDER_ID } from "./models.js";
import { createSignedFetch } from "./signed-fetch.js";

export { PROVIDER_ID } from "./models.js";

export function createMantleProvider(ai, config, credentials = createCredentials(config.profile), modelCache = createModelCache(config)) {
  const catalog = ai.getModels("amazon-bedrock");
  let discovered = { models: [], skipped: [] };
  let checkedAt;
  let error;
  const optionsFor = (options = {}) => ({
    ...options,
    apiKey: "iam-sigv4-not-a-secret",
    fetch: createSignedFetch({ region: config.region, credentials, fetchImplementation: options.fetch || globalThis.fetch }),
  });
  const api = Object.fromEntries([
    ["openai-responses", ai.openAIResponsesApi()],
    ["openai-completions", ai.openAICompletionsApi()],
    ["anthropic-messages", ai.anthropicMessagesApi()],
  ].map(([name, streams]) => [name, {
    stream: (model, context, options) => streams.stream(model, context, optionsFor(options)),
    streamSimple: (model, context, options) => streams.streamSimple(model, context, optionsFor(options)),
  }]));
  const provider = ai.createProvider({
    id: PROVIDER_ID, name: "AWS Bedrock Mantle (IAM)", baseUrl: config.baseUrl,
    auth: {
      apiKey: {
        name: "AWS IAM credentials (SigV4)",
        resolve: async () => ({ auth: { apiKey: "iam-sigv4-not-a-secret" }, source: config.profile ? `AWS profile ${config.profile}` : "AWS credential chain" }),
      },
    },
    models: [], api,
  });
  return {
    ...provider,
    getModels: () => discovered.models,
    getAllModels: () => discovered.models,
    getDiscoveryStatus: () => ({ count: discovered.models.length, skipped: [...discovered.skipped], checkedAt, error }),
    refreshModels: async context => {
      if (context.signal.aborted) return;
      if (!context.force) {
        if (checkedAt && Date.now() - checkedAt < MODEL_CACHE_TTL_MS) return;
        const cached = await modelCache.read();
        if (context.signal.aborted) return;
        if (cached) {
          const next = mapMantleModels(cached.entries, catalog, config);
          await context.publish({ update: () => { discovered = next; checkedAt = cached.checkedAt; error = undefined; } });
          return;
        }
      }
      if (!context.allowNetwork) return;
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]);
      try {
        const entries = await listMantleModels(config, optionsFor().fetch, signal);
        const next = mapMantleModels(entries, catalog, config);
        const completedAt = Date.now();
        signal.throwIfAborted();
        const published = await context.publish({ update: () => { discovered = next; checkedAt = completedAt; error = undefined; } });
        if (published) await modelCache.write(entries, completedAt);
      } catch (failure) {
        if (!context.signal.aborted) {
          const message = signal.aborted ? "Mantle model discovery timed out after 10 seconds." : failure.message;
          await context.publish({ update: () => { error = message; } });
          throw new Error(message);
        }
      }
    },
  };
}
