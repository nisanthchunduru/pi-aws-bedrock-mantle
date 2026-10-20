import { Sha256 } from "@aws-crypto/sha256-js";
import { SignatureV4 } from "@smithy/signature-v4";

export function createSignedFetch({ region, credentials, fetchImplementation = globalThis.fetch }) {
  const origin = `https://bedrock-mantle.${region}.api.aws`;
  const signer = new SignatureV4({ credentials, region, service: "bedrock-mantle", sha256: Sha256 });

  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== origin || url.username || url.password || url.pathname !== "/openai/v1/responses" || url.search || url.hash || request.method !== "POST") {
      throw new Error("Refusing to sign a request outside the configured Mantle Responses endpoint.");
    }
    request.signal.throwIfAborted();
    const body = new Uint8Array(await request.arrayBuffer());
    const signed = await signer.sign({
      method: "POST", protocol: "https:", hostname: url.hostname, path: url.pathname,
      headers: { host: url.host, "content-type": "application/json" }, body,
    });
    request.signal.throwIfAborted();
    const headers = new Headers(request.headers);
    for (const name of [...headers.keys()]) {
      if (["authorization", "x-api-key", "api-key", "cookie", "proxy-authorization", "content-length", "host", "connection", "transfer-encoding"].includes(name) || name.startsWith("x-amz-")) headers.delete(name);
    }
    for (const [name, value] of Object.entries(signed.headers)) headers.set(name, value);
    return fetchImplementation(url.href, {
      method: "POST", headers, body, signal: request.signal,
      redirect: "error", credentials: "omit",
    });
  };
}
