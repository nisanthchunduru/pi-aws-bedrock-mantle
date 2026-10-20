import { deflateSync } from "node:zlib";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(name: string, bytes: Buffer): Buffer {
  const type = Buffer.from(name);
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
  return Buffer.concat([length, type, bytes, checksum]);
}

function testImage(): string {
  const header = Buffer.alloc(13); header.writeUInt32BE(64, 0); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(64 * 193);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) pixels[y * 193 + 1 + x * 3] = 255;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

export default function visionFixture(pi: ExtensionAPI) {
  pi.registerTool({
    name: "vision_fixture", label: "Generated vision fixture", description: "Return a generated image for the vision test.",
    parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "image" as const, mimeType: "image/png", data: testImage() }], details: undefined }),
  });
  pi.on("before_provider_request", (event, ctx) => {
    if (ctx.model?.provider !== "aws-bedrock-mantle") return;
    const payload = event.payload as { input?: { type?: string; output?: { type?: string }[] }[] };
    const images = payload.input?.filter(item => item.type === "function_call_output")
      .flatMap(item => Array.isArray(item.output) ? item.output : []).filter(item => item.type === "input_image").length ?? 0;
    if (images) console.error(`Vision verification: ${images} image block(s) inside Responses function_call_output.output`);
  });
}
