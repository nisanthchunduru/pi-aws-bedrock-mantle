import * as ai from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./src/config.js";
import { createMantleProvider, PROVIDER_ID } from "./src/provider.js";

export default async function bedrockMantle(pi: ExtensionAPI) {
  const config = loadConfig();
  const provider = createMantleProvider(ai, config);
  try {
    await provider.refreshModels({
      allowNetwork: process.env.PI_OFFLINE === undefined,
      signal: new AbortController().signal,
      publish: async ({ update }) => { update?.(); return true; },
    });
  } catch (error) {
    console.warn(`[${PROVIDER_ID}] ${error.message}`);
  }
  pi.registerProvider(provider);
  pi.registerCommand("aws-bedrock-mantle-status", {
    description: "Show Mantle discovery status, skipped models and IAM profile without credentials",
    handler: async (_args, ctx) => {
      const status = provider.getDiscoveryStatus();
      const details = [
        `${PROVIDER_ID}: ${config.region}; AWS profile: ${config.profile || "default chain"}; models: ${status.count}`,
        `Last discovery: ${status.checkedAt ? new Date(status.checkedAt).toISOString() : "not completed"}`,
        ...(status.skipped.length ? [`Skipped (missing catalog metadata or API mapping): ${status.skipped.join(", ")}`] : []),
        ...(status.error ? [status.error] : []),
      ];
      ctx.ui.notify(details.join("\n"), status.error ? "warning" : "info");
    },
  });
  pi.registerCommand("aws-bedrock-mantle-refresh-models", {
    description: "Refresh the configured region's Mantle models",
    handler: async (_args, ctx) => {
      const result = await ctx.modelRegistry.refresh({ providers: [PROVIDER_ID], force: true });
      const error = result.errors.get(PROVIDER_ID);
      ctx.ui.notify(error ? error.message : `Mantle models: ${provider.getModels().length}. See /aws-bedrock-mantle-status for details.`, error ? "warning" : "info");
    },
  });
}
