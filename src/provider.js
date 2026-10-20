import { createCredentials } from "./credentials.js";
import { createSignedFetch } from "./signed-fetch.js";

export const PROVIDER_ID = "aws-bedrock-mantle";

export function astraModel(config) {
  return {
    id: "openai.gpt-6-astra", name: "GPT-6 Astra (Bedrock Mantle · IAM)", type: "chat",
    provider: PROVIDER_ID, api: "openai-responses", baseUrl: config.baseUrl,
    reasoning: true, input: ["text", "image"], contextWindow: 1_050_000, maxTokens: 128_000,
    thinkingLevelMap: { xhigh: "xhigh" },
    cost: {
      input: 11, output: 55, cacheRead: 1.1, cacheWrite: 13.75,
      tiers: [{ inputTokensAbove: 272_000, input: 22, output: 82.5, cacheRead: 2.2, cacheWrite: 27.5 }],
    },
  };
}

export function createMantleProvider(ai, config, credentials = createCredentials(config.profile)) {
  const responses = ai.openAIResponsesApi();
  const optionsFor = (options = {}) => ({
    ...options,
    apiKey: "iam-sigv4-not-a-secret",
    fetch: createSignedFetch({ region: config.region, credentials, fetchImplementation: options.fetch || globalThis.fetch }),
  });
  const streams = {
    stream: (model, context, options) => responses.stream(model, context, optionsFor(options)),
    streamSimple: (model, context, options) => responses.streamSimple(model, context, optionsFor(options)),
  };
  return ai.createProvider({
    id: PROVIDER_ID, name: "AWS Bedrock Mantle (IAM)", baseUrl: config.baseUrl,
    auth: {
      apiKey: {
        name: "AWS IAM credentials (SigV4)",
        resolve: async () => ({ auth: { apiKey: "iam-sigv4-not-a-secret" }, source: config.profile ? `AWS profile ${config.profile}` : "AWS credential chain" }),
      },
    },
    models: [astraModel(config)], api: { "openai-responses": streams },
  });
}
