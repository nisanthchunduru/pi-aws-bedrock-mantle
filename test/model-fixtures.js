export const astra = {
  id: "openai.gpt-6-astra", name: "GPT-6 Astra", type: "chat", provider: "amazon-bedrock",
  api: "bedrock-converse-stream", baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
  reasoning: true, input: ["text", "image"], contextWindow: 1_050_000, maxTokens: 128_000,
  thinkingLevelMap: { xhigh: "xhigh" },
  cost: { input: 11, output: 55, cacheRead: 1.1, cacheWrite: 13.75 },
  compat: { supportsStrictMode: true }, inputLimits: { images: { maxPerMessage: 20 } },
};

export const catalog = [
  astra,
  { ...astra, id: "openai.gpt-oss-120b", name: "GPT OSS 120B", input: ["text"] },
  { ...astra, id: "google.gemma-4-31b", name: "Gemma 4 31B" },
  { ...astra, id: "us.xai.grok-4.6", name: "Grok 4.6" },
  { ...astra, id: "deepseek.v3.2", name: "DeepSeek V3.2", input: ["text"] },
  { ...astra, id: "us.anthropic.claude-haiku-4-5-20251001-v1:0", name: "Claude Haiku 4.5" },
  { ...astra, id: "qwen.qwen3-32b-v1:0", name: "Qwen3 32B" },
];

export function mockAi(stream = () => {}) {
  const streams = () => ({ stream, streamSimple: stream });
  return {
    getModels: provider => provider === "amazon-bedrock" ? catalog : [],
    createProvider: value => value,
    openAIResponsesApi: streams, openAICompletionsApi: streams, anthropicMessagesApi: streams,
  };
}

export const refreshContext = (options = {}) => ({
  allowNetwork: true, signal: new AbortController().signal,
  publish: async ({ update }) => { update?.(); return true; },
  ...options,
});
