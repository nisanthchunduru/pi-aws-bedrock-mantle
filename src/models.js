export const PROVIDER_ID = "aws-bedrock-mantle";

export function modelRoute(id) {
  if (id.startsWith("openai.gpt-oss-")) return { api: "openai-completions", path: "/v1" };
  if (id.startsWith("openai.gpt-")) return { api: "openai-responses", path: "/openai/v1" };
  if (id.startsWith("anthropic.claude-")) return { api: "anthropic-messages", path: "/anthropic" };
  if (/^(google\.gemma-|xai\.grok-)/.test(id)) return { api: "openai-completions", path: "/openai/v1" };
  if (/^(deepseek|mistral|qwen|nvidia|moonshotai|minimax|zai|writer)\./.test(id)) {
    return { api: "openai-completions", path: "/v1" };
  }
}

function catalogId(id) {
  return id.replace(/^(us|eu|apac|global)\./, "").replace(/(?:-v\d+)?:\d+$/, "");
}

function findMetadata(id, catalog) {
  const exact = catalog.find(model => model.id === id);
  if (exact) return exact;
  const regional = catalog.find(model => catalogId(model.id) === id);
  if (regional) return regional;
  if (id.startsWith("anthropic.claude-")) {
    return catalog.find(model => catalogId(model.id).replace(/-\d{8}$/, "") === id);
  }
}

export function mapMantleModels(entries, catalog, config) {
  const models = [];
  const skipped = [];
  const chatCatalog = catalog.filter(model => !model.type || model.type === "chat");
  for (const id of [...new Set(entries.filter(entry => !entry.status || entry.status === "available").map(entry => entry.id))].sort()) {
    const route = modelRoute(id);
    const metadata = findMetadata(id, chatCatalog);
    if (!route || !metadata) {
      skipped.push(id);
      continue;
    }
    const { name, reasoning, input, cost, contextWindow, maxTokens, thinkingLevelMap } = metadata;
    models.push({
      id, name: name?.trim() || id, type: "chat", provider: PROVIDER_ID,
      api: route.api, baseUrl: `https://bedrock-mantle.${config.region}.api.aws${route.path}`,
      reasoning, input, cost, contextWindow, maxTokens,
      ...(thinkingLevelMap && { thinkingLevelMap }),
      ...(route.api === "openai-completions" && {
        compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, supportsStrictMode: false, maxTokensField: "max_tokens" },
      }),
    });
  }
  return { models, skipped };
}
