import { Sha256 } from "@aws-crypto/sha256-js";
import { SignatureV4 } from "@smithy/signature-v4";

const inferencePaths = new Set(["/openai/v1/responses", "/openai/v1/chat/completions", "/v1/chat/completions", "/anthropic/v1/messages"]);

async function signWithAbort(signer, request, signal) {
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([signer.sign(request), aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

export function createSignedFetch({ region, credentials, fetchImplementation = globalThis.fetch }) {
  const origin = `https://bedrock-mantle.${region}.api.aws`;
  const signer = new SignatureV4({ credentials, region, service: "bedrock-mantle", sha256: Sha256 });

  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const allowedRoute = (request.method === "GET" && url.pathname === "/v1/models") || (request.method === "POST" && inferencePaths.has(url.pathname));
    const anthropicBeta = request.method === "POST" && url.pathname === "/anthropic/v1/messages" && url.search === "?beta=true";
    if (url.origin !== origin || url.username || url.password || (url.search && !anthropicBeta) || url.hash || !allowedRoute) {
      throw new Error("Refusing to sign a request outside the configured Mantle discovery and inference endpoints.");
    }
    request.signal.throwIfAborted();
    const body = request.method === "GET" ? undefined : new Uint8Array(await request.arrayBuffer());
    request.signal.throwIfAborted();
    const signed = await signWithAbort(signer, {
      method: request.method, protocol: "https:", hostname: url.hostname, path: url.pathname,
      ...(anthropicBeta && { query: { beta: "true" } }),
      headers: { host: url.host, ...(body && { "content-type": "application/json" }) }, body,
    }, request.signal);
    request.signal.throwIfAborted();
    const headers = new Headers(request.headers);
    for (const name of [...headers.keys()]) {
      if (["authorization", "x-api-key", "api-key", "cookie", "proxy-authorization", "content-length", "host", "connection", "transfer-encoding"].includes(name) || name.startsWith("x-amz-")) headers.delete(name);
    }
    for (const [name, value] of Object.entries(signed.headers)) headers.set(name, value);
    return fetchImplementation(url.href, {
      method: request.method, headers, body, signal: request.signal,
      redirect: "error", credentials: "omit",
    });
  };
}
