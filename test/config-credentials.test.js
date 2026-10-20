import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig, resolveConfig } from "../src/config.js";
import { refreshableCredentials } from "../src/credentials.js";
import { astraModel, createMantleProvider, PROVIDER_ID } from "../src/provider.js";

const key = { accessKeyId: "TEST", secretAccessKey: "fake" };

test("Defaults point to Astra's supported Oregon Mantle Responses endpoint", () => {
  const config = resolveConfig({});
  assert.equal(config.region, "us-west-2");
  assert.equal(config.baseUrl, "https://bedrock-mantle.us-west-2.api.aws/openai/v1");
  assert.equal(config.profile, undefined);
  const model = astraModel(config);
  assert.equal(model.api, "openai-responses");
  assert.deepEqual(model.input, ["text", "image"]);
  assert.equal(model.contextWindow, 1050000);
});

test("Standard AWS variables override saved defaults", () => {
  const config = resolveConfig({
    AWS_PROFILE: "standard-profile", AWS_REGION: "us-east-1", AWS_DEFAULT_REGION: "us-west-2",
  }, { profile: "saved", region: "us-west-2" });
  assert.equal(config.profile, "standard-profile");
  assert.equal(config.region, "us-east-1");
  assert.equal(config.baseUrl, "https://bedrock-mantle.us-east-1.api.aws/openai/v1");
});

test("AWS_DEFAULT_REGION is used when AWS_REGION is absent or empty", () => {
  for (const AWS_REGION of [undefined, ""]) {
    const config = resolveConfig({ AWS_REGION, AWS_DEFAULT_REGION: "us-east-1" }, { region: "us-west-2" });
    assert.equal(config.region, "us-east-1");
  }
});

test("Removed Mantle profile and region aliases are ignored", () => {
  const env = { BEDROCK_MANTLE_AWS_PROFILE: "obsolete", BEDROCK_MANTLE_REGION: "us-east-2" };
  const config = resolveConfig(env, { profile: "saved", region: "us-west-2" });
  assert.equal(config.profile, "saved");
  assert.equal(config.region, "us-west-2");
  assert.equal(resolveConfig(env).profile, undefined);
  assert.equal(resolveConfig(env).region, "us-west-2");
});

test("Configuration uses XDG_CONFIG_HOME and ignores the removed Mantle config-path override", () => {
  const root = join(homedir(), "tmp-workspaces");
  mkdirSync(root, { recursive: true });
  const workspace = mkdtempSync(join(root, "mantle-config-"));
  const directory = join(workspace, "tmp");
  mkdirSync(join(directory, "pi-aws-bedrock-mantle"), { recursive: true });
  try {
    writeFileSync(join(directory, "pi-aws-bedrock-mantle", "config.json"), JSON.stringify({ profile: "saved", region: "us-east-1" }));
    const obsoletePath = join(directory, "obsolete.json");
    writeFileSync(obsoletePath, "invalid JSON that must not be read");
    const config = loadConfig({ XDG_CONFIG_HOME: directory, BEDROCK_MANTLE_CONFIG: obsoletePath });
    assert.equal(config.profile, "saved");
    assert.equal(config.region, "us-east-1");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Saved defaults still work without environment overrides", () => {
  const config = resolveConfig({}, { profile: "saved", region: "us-east-1" });
  assert.equal(config.profile, "saved");
  assert.equal(config.region, "us-east-1");
});

test("An unsupported standard region fails explicitly rather than silently using another region", () => {
  assert.throws(() => resolveConfig({ AWS_REGION: "us-east-2" }), /Set AWS_REGION/);
});

test("Concurrent signing requests share credential resolution and refresh near expiration", async () => {
  let clock = 1000;
  let calls = 0;
  const provider = refreshableCredentials(async () => { calls++; return { ...key, expiration: new Date(clock + 90_000) }; }, () => clock);
  await Promise.all([provider(), provider(), provider()]);
  assert.equal(calls, 1);
  clock += 10_000;
  await provider();
  assert.equal(calls, 1);
  clock += 60_000;
  await provider();
  assert.equal(calls, 2);
});

test("Credential failures are not cached and expired keys are never returned", async () => {
  let calls = 0;
  const provider = refreshableCredentials(async () => {
    if (++calls === 1) throw Error("profile unavailable");
    return key;
  });
  await assert.rejects(provider(), /profile unavailable/);
  assert.equal(await provider(), key);
  const expired = refreshableCredentials(async () => ({ ...key, expiration: new Date(0) }));
  await assert.rejects(expired(), /expired/);
});

test("Non-expiring credential sources are re-read after a short cache interval", async () => {
  let clock = 0;
  let calls = 0;
  const provider = refreshableCredentials(async () => { calls++; return key; }, () => clock);
  await provider(); clock = 60_001; await provider();
  assert.equal(calls, 2);
});

test("Provider preserves payload/response/event hooks and delegates normalization to Pi", () => {
  let forwarded;
  const ai = {
    createProvider: value => value,
    openAIResponsesApi: () => ({ stream: (...args) => { forwarded = args; }, streamSimple: (...args) => { forwarded = args; } }),
  };
  const config = resolveConfig({}, { profile: "fixture" });
  const provider = createMantleProvider(ai, config, async () => key);
  assert.equal(provider.id, PROVIDER_ID);
  const options = { onPayload: () => {}, onResponse: () => {}, onProviderStreamEvent: () => {}, signal: AbortSignal.abort(), reasoning: "high" };
  const model = astraModel(config); const context = { messages: [] };
  provider.api["openai-responses"].streamSimple(model, context, options);
  assert.equal(forwarded[0], model);
  assert.equal(forwarded[1], context);
  for (const name of Object.keys(options)) assert.equal(forwarded[2][name], options[name]);
  assert.equal(typeof forwarded[2].fetch, "function");
});
