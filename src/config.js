import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveConfig(env = process.env, saved = {}) {
  const region = env.AWS_REGION || env.AWS_DEFAULT_REGION || saved.region || "us-west-2";
  const profile = env.AWS_PROFILE || saved.profile || undefined;
  if (!["us-east-1", "us-west-2"].includes(region)) {
    throw new Error("This Mantle extension supports region us-east-1 or us-west-2. Set AWS_REGION.");
  }
  if (profile !== undefined && (typeof profile !== "string" || !profile.trim())) {
    throw new Error("Bedrock Mantle profile must be a nonempty AWS profile name.");
  }
  const cacheDirectory = join(env.XDG_CACHE_HOME || join(env.HOME || homedir(), ".cache"), "pi-aws-bedrock-mantle");
  return { region, profile, baseUrl: `https://bedrock-mantle.${region}.api.aws/openai/v1`, cacheDirectory };
}

export function loadConfig(env = process.env) {
  const path = join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"), "pi-aws-bedrock-mantle", "config.json");
  let saved;
  try { saved = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Cannot read Bedrock Mantle configuration at ${path}; expected JSON with profile and region.`);
    saved = {};
  }
  if (!saved || typeof saved !== "object" || Array.isArray(saved) || Object.keys(saved).some(key => !["profile", "region"].includes(key))) {
    throw new Error("Bedrock Mantle configuration permits only profile and region; do not put credentials in this file.");
  }
  return resolveConfig(env, saved);
}
