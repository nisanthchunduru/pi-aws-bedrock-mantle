import * as ai from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./src/config.js";
import { createMantleProvider, PROVIDER_ID } from "./src/provider.js";

export default function bedrockMantle(pi: ExtensionAPI) {
  const config = loadConfig();
  pi.registerProvider(createMantleProvider(ai, config));
  pi.registerCommand("mantle-status", {
    description: "Show Mantle endpoint and IAM profile without credentials",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`${PROVIDER_ID}: ${config.baseUrl}; AWS profile: ${config.profile || "default chain"}; API: Responses`, "info");
    },
  });
}
