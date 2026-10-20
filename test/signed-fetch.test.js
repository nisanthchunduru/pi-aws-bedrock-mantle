import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createSignedFetch } from "../src/signed-fetch.js";

const url = "https://bedrock-mantle.us-west-2.api.aws/openai/v1/responses";
const credentials = { accessKeyId: "TESTACCESSKEY", secretAccessKey: "test-secret-not-real", sessionToken: "test-session-not-real" };
const image = { type: "input_image", image_url: "data:image/png;base64,AQID", detail: "auto" };

for (const input of [
  [{ role: "user", content: [image] }],
  [{ type: "function_call_output", call_id: "call_1", output: [image] }],
  [{ type: "function_call_output", call_id: "call_1", output: [{ type: "input_text", text: "caption" }, image] }, { type: "function_call_output", call_id: "call_2", output: [image] }],
]) {
  test(`Image bytes and placement are unchanged when signing ${JSON.stringify(input).length}-byte input`, async () => {
    const body = JSON.stringify({ model: "openai.gpt-6-astra", input });
    let captured;
    const expectedResponse = new Response("ok");
    const signedFetch = createSignedFetch({ region: "us-west-2", credentials, fetchImplementation: async (...args) => { captured = args; return expectedResponse; } });
    const actualResponse = await signedFetch(url, { method: "POST", body, headers: { authorization: "Bearer dummy", "x-api-key": "remove-me", cookie: "remove-me", "x-amz-security-token": "old", "x-client-request-id": "keep-me" } });
    assert.equal(actualResponse, expectedResponse);
    const [destination, options] = captured;
    assert.equal(destination, url);
    assert.equal(Buffer.from(options.body).toString(), body);
    assert.match(options.headers.get("authorization"), /Credential=TESTACCESSKEY\/\d{8}\/us-west-2\/bedrock-mantle\/aws4_request/);
    assert.equal(options.headers.get("x-amz-content-sha256"), createHash("sha256").update(body).digest("hex"));
    assert.equal(options.headers.get("x-amz-security-token"), credentials.sessionToken);
    assert.equal(options.headers.get("x-api-key"), null);
    assert.equal(options.headers.get("cookie"), null);
    assert.equal(options.headers.get("content-length"), null);
    assert.equal(options.headers.get("x-client-request-id"), "keep-me");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
  });
}

for (const destination of [
  "https://attacker.example/openai/v1/responses",
  "http://bedrock-mantle.us-west-2.api.aws/openai/v1/responses",
  "https://bedrock-mantle.us-east-1.api.aws/openai/v1/responses",
  `${url}?redirect=other`, `${url}/elsewhere`, `${url}#fragment`,
]) {
  test(`Refuses signing outside the exact configured route: ${destination}`, async () => {
    let accessed = false;
    const signedFetch = createSignedFetch({ region: "us-west-2", credentials: async () => { accessed = true; return credentials; }, fetchImplementation: async () => { throw Error("must not fetch"); } });
    await assert.rejects(signedFetch(destination, { method: "POST", body: "{}" }), /Refusing to sign/);
    assert.equal(accessed, false);
  });
}

test("Already aborted requests do not resolve credentials or make HTTP calls", async () => {
  let accessed = false;
  const signedFetch = createSignedFetch({ region: "us-west-2", credentials: async () => { accessed = true; return credentials; } });
  await assert.rejects(signedFetch(url, { method: "POST", body: "{}", signal: AbortSignal.abort() }), { name: "AbortError" });
  assert.equal(accessed, false);
});

test("Request objects work and cancellation reaches the underlying fetch", async () => {
  const controller = new AbortController();
  const signedFetch = createSignedFetch({ region: "us-west-2", credentials, fetchImplementation: async (_url, options) => {
    controller.abort();
    assert.equal(options.signal.aborted, true);
    options.signal.throwIfAborted();
  } });
  await assert.rejects(signedFetch(new Request(url, { method: "POST", body: "{}", signal: controller.signal })), { name: "AbortError" });
});

test("Upstream status, errors, headers and streaming body pass through without buffering", async () => {
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("data: first\n\n")); } });
  const response = new Response(body, { headers: { "content-type": "text/event-stream", "x-request-id": "request-1" } });
  const signedFetch = createSignedFetch({ region: "us-west-2", credentials, fetchImplementation: async () => response });
  const actual = await signedFetch(url, { method: "POST", body: "{}" });
  assert.equal(actual, response);
  const reader = actual.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "data: first\n\n");
  await reader.cancel();
  const failure = new Response('{"error":"denied"}', { status: 403 });
  const failedFetch = createSignedFetch({ region: "us-west-2", credentials, fetchImplementation: async () => failure });
  assert.equal(await failedFetch(url, { method: "POST", body: "{}" }), failure);
});
