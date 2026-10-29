import { createCredentials } from "./credentials.js";
import { listMantleModels } from "./discovery.js";
import { mapMantleModels, PROVIDER_ID } from "./models.js";
import { createSignedFetch } from "./signed-fetch.js";

const MODEL_CACHE_TTL_MS = 5 * 60_000;

export { PROVIDER_ID } from "./models.js";

export function createMantleProvider(ai, config, credentials = createCredentials(config.profile)) {
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
      if (!context.allowNetwork || context.signal.aborted) return;
      if (!context.force && checkedAt && Date.now() - checkedAt < MODEL_CACHE_TTL_MS) return;
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]);
      try {
        const entries = await listMantleModels(config, optionsFor().fetch, signal);
        const next = mapMantleModels(entries, catalog, config);
        signal.throwIfAborted();
        await context.publish({ update: () => { discovered = next; checkedAt = Date.now(); error = undefined; } });
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
