import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveConfig } from "../src/config.js";
import { listMantleModels } from "../src/discovery.js";
import { mapMantleModels } from "../src/models.js";
import { createMantleProvider } from "../src/provider.js";
import { astra, catalog, mockAi, refreshContext } from "./model-fixtures.js";

const config = { ...resolveConfig({}), cacheDirectory: undefined };
const credentials = async () => ({ accessKeyId: "TEST", secretAccessKey: "fake" });
const entries = ids => ids.map(id => ({ id, status: "available" }));

test("Discovery calls /v1/models rather than the inference prefix and forwards cancellation", async () => {
  const signal = new AbortController().signal;
  const data = entries([astra.id]);
  const result = await listMantleModels(config, async (url, options) => {
    assert.equal(url, "https://bedrock-mantle.us-west-2.api.aws/v1/models");
    assert.equal(options.signal, signal);
    return Response.json({ object: "list", data });
  }, signal);
  assert.deepEqual(result, data);
});

for (const [body, message] of [
  [{}, /invalid model list/],
  [{ data: [null] }, /invalid model list/],
  [{ data: [{ id: "" }] }, /invalid model list/],
  [{ data: [{ id: "host/model?redirect=x" }] }, /invalid model list/],
  [{ data: [], has_more: true }, /paginated/],
  [{ data: [], nextToken: "next" }, /paginated/],
]) {
  test(`Invalid or partial model lists are rejected: ${JSON.stringify(body)}`, async () => {
    await assert.rejects(listMantleModels(config, async () => Response.json(body), new AbortController().signal), message);
  });
}

test("Permission, credential and malformed JSON errors never echo upstream bodies or secrets", async () => {
  for (const [fetch, expected] of [
    [async () => new Response("secret", { status: 403 }), /HTTP 403.*ListModels/],
    [async () => { throw new Error("secret"); }, /Check AWS credentials/],
    [async () => new Response("secret"), /invalid JSON/],
  ]) {
    await assert.rejects(listMantleModels(config, fetch, new AbortController().signal), error => {
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  }
});

test("Discovered IDs select separate Responses, Chat Completions and Messages routes", () => {
  const { models, skipped } = mapMantleModels(entries([
    astra.id, "openai.gpt-oss-120b", "deepseek.v3.2", "anthropic.claude-haiku-4-5", "google.gemma-4-31b", "qwen.qwen3-32b", "xai.grok-4.6",
  ]), catalog, config);
  assert.deepEqual(skipped, []);
  assert.equal(models.length, 7);
  for (const [id, api, path] of [
    [astra.id, "openai-responses", "/openai/v1"],
    ["openai.gpt-oss-120b", "openai-completions", "/v1"],
    ["deepseek.v3.2", "openai-completions", "/v1"],
    ["google.gemma-4-31b", "openai-completions", "/openai/v1"],
    ["xai.grok-4.6", "openai-completions", "/openai/v1"],
    ["anthropic.claude-haiku-4-5", "anthropic-messages", "/anthropic"],
  ]) {
    const model = models.find(model => model.id === id);
    assert.equal(model.api, api);
    assert.equal(model.baseUrl, `https://bedrock-mantle.us-west-2.api.aws${path}`);
  }
});

test("Only discovered available chat models with known metadata and routes are registered, sorted and deduplicated", () => {
  const { models, skipped } = mapMantleModels([
    ...entries([astra.id, astra.id, "openai.unknown", "unmapped.model", "openai.gpt-classifier"]),
    { id: "deepseek.v3.2", status: "unavailable" },
  ], [...catalog, { ...astra, id: "unmapped.model" }, { ...astra, id: "openai.gpt-classifier", type: "classifier" }], config);
  assert.deepEqual(models.map(model => model.id), [astra.id]);
  assert.deepEqual(skipped, ["openai.gpt-classifier", "openai.unknown", "unmapped.model"]);
  assert.equal(models[0].contextWindow, astra.contextWindow);
  assert.deepEqual(models[0].cost, astra.cost);
  assert.deepEqual(models[0].thinkingLevelMap, astra.thinkingLevelMap);
  assert.equal(models[0].compat, undefined);
  assert.equal(models[0].inputLimits, undefined);
  assert.equal(models[0].headers, undefined);
  assert.deepEqual(mapMantleModels([], catalog, config), { models: [], skipped: [] });
});

test("Display names come from Pi's Bedrock catalog, including normalized model IDs, without a suffix", () => {
  const { models } = mapMantleModels(entries([astra.id, "anthropic.claude-haiku-4-5", "xai.grok-4.6"]), catalog, config);
  assert.deepEqual(models.map(({ id, name }) => ({ id, name })), [
    { id: "anthropic.claude-haiku-4-5", name: "Claude Haiku 4.5" },
    { id: astra.id, name: "GPT-6 Astra" },
    { id: "xai.grok-4.6", name: "Grok 4.6" },
  ]);
});

test("Missing or blank catalog names fall back to the discovered model ID", () => {
  for (const name of [undefined, null, "", "   "]) {
    const { models } = mapMantleModels(entries([astra.id]), [{ ...astra, name }], config);
    assert.equal(models[0].name, astra.id);
  }
});

test("Different model versions are not matched by fuzzy prefix", () => {
  const { models } = mapMantleModels(entries(["openai.gpt-6", "deepseek.v3", "openai.gpt-6-astra-2026-01-01"]), catalog, config);
  assert.deepEqual(models, []);
});

test("Successful discovery is cached for five minutes unless refresh is forced", async t => {
  let clock = 1_000;
  let calls = 0;
  t.mock.method(Date, "now", () => clock);
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ data: entries([astra.id]) });
  });
  const provider = createMantleProvider(mockAi(), config, credentials);

  await provider.refreshModels(refreshContext());
  clock += 5 * 60_000 - 1;
  await provider.refreshModels(refreshContext());
  assert.equal(calls, 1);

  clock++;
  await provider.refreshModels(refreshContext());
  assert.equal(calls, 2);

  await provider.refreshModels(refreshContext({ force: true }));
  assert.equal(calls, 3);
});

test("Fresh disk cache is shared by Pi processes and isolated by profile and region", async t => {
  const root = join(homedir(), "tmp-workspaces");
  mkdirSync(root, { recursive: true });
  const workspace = mkdtempSync(join(root, "mantle-model-cache-"));
  const cacheDirectory = join(workspace, "cache");
  let clock = 10_000;
  let calls = 0;
  t.mock.method(Date, "now", () => clock);
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ data: entries([astra.id]) });
  });

  try {
    const sharedConfig = { ...config, profile: "shared-profile", cacheDirectory };
    const first = createMantleProvider(mockAi(), sharedConfig, credentials);
    await first.refreshModels(refreshContext());
    assert.equal(calls, 1);

    const second = createMantleProvider(mockAi(), sharedConfig, () => { throw new Error("must not resolve"); });
    await second.refreshModels(refreshContext({ allowNetwork: false }));
    assert.deepEqual(second.getModels().map(model => model.id), [astra.id]);
    assert.equal(second.getDiscoveryStatus().checkedAt, clock);
    assert.equal(calls, 1);

    const otherProfile = createMantleProvider(mockAi(), { ...sharedConfig, profile: "other-profile" }, credentials);
    await otherProfile.refreshModels(refreshContext({ allowNetwork: false }));
    assert.deepEqual(otherProfile.getModels(), []);

    const otherRegion = createMantleProvider(mockAi(), {
      ...sharedConfig,
      region: "us-east-1",
      baseUrl: "https://bedrock-mantle.us-east-1.api.aws/openai/v1",
    }, credentials);
    await otherRegion.refreshModels(refreshContext({ allowNetwork: false }));
    assert.deepEqual(otherRegion.getModels(), []);

    clock += 5 * 60_000;
    const expired = createMantleProvider(mockAi(), sharedConfig, credentials);
    await expired.refreshModels(refreshContext());
    assert.equal(calls, 2);

    const forced = createMantleProvider(mockAi(), sharedConfig, credentials);
    await forced.refreshModels(refreshContext({ force: true }));
    assert.equal(calls, 3);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Live refresh replaces the catalog, keeps the previous list on failure and clears it on a successful empty response", async t => {
  let data = entries([astra.id, "deepseek.v3.2"]);
  let status = 200;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ data }, { status });
  });
  const provider = createMantleProvider(mockAi(), config, credentials);
  assert.deepEqual(provider.getModels(), []);
  await provider.refreshModels(refreshContext());
  assert.equal(provider.getModels().length, 2);
  assert.equal(provider.getAllModels(), provider.getModels());
  await provider.refreshModels(refreshContext());
  assert.equal(calls, 1);
  status = 403;
  await assert.rejects(provider.refreshModels(refreshContext({ force: true })), /ListModels/);
  assert.equal(provider.getModels().length, 2);
  assert.match(provider.getDiscoveryStatus().error, /403/);
  status = 200; data = [];
  await provider.refreshModels(refreshContext({ force: true }));
  assert.deepEqual(provider.getModels(), []);
  assert.equal(provider.getDiscoveryStatus().error, undefined);
});

test("Offline and aborted refreshes neither resolve credentials nor restore another region's persisted catalog", async () => {
  const provider = createMantleProvider(mockAi(), config, () => { throw new Error("must not resolve"); });
  await provider.refreshModels(refreshContext({ allowNetwork: false, stored: { models: catalog } }));
  await provider.refreshModels(refreshContext({ signal: AbortSignal.abort() }));
  assert.deepEqual(provider.getModels(), []);
});

test("A superseded publication cannot change the live catalog", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: entries([astra.id]) }));
  const provider = createMantleProvider(mockAi(), config, credentials);
  await provider.refreshModels(refreshContext({ publish: async () => false }));
  assert.deepEqual(provider.getModels(), []);
  assert.equal(provider.getDiscoveryStatus().checkedAt, undefined);
});

test("Discovery deadlines produce a useful status without exposing credential errors", async t => {
  t.mock.method(AbortSignal, "timeout", milliseconds => {
    assert.equal(milliseconds, 10_000);
    return AbortSignal.abort(new DOMException("internal detail", "TimeoutError"));
  });
  const provider = createMantleProvider(mockAi(), config, () => { throw Error("must not resolve"); });
  await assert.rejects(provider.refreshModels(refreshContext()), /timed out after 10 seconds/);
  assert.match(provider.getDiscoveryStatus().error, /timed out after 10 seconds/);
  assert.deepEqual(provider.getModels(), []);
});

test("Aborting discovery cancels HTTP I/O and does not publish incomplete models", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    controller.abort();
    options.signal.throwIfAborted();
  });
  const provider = createMantleProvider(mockAi(), config, credentials);
  await provider.refreshModels(refreshContext({ signal: controller.signal, publish: () => { throw Error("must not publish"); } }));
  assert.deepEqual(provider.getModels(), []);
});
