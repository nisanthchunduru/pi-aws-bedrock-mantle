export function validateMantleModelEntries(entries) {
  if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(entry.id))) {
    throw new Error("Mantle model discovery returned an invalid model list.");
  }
  return entries;
}

export async function listMantleModels(config, signedFetch, signal) {
  signal.throwIfAborted();
  let response;
  try {
    response = await signedFetch(`https://bedrock-mantle.${config.region}.api.aws/v1/models`, { signal });
  } catch {
    signal.throwIfAborted();
    throw new Error("Mantle model discovery failed. Check AWS credentials, profile, region and connectivity.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    const permission = response.status === 403 ? " Check bedrock-mantle:ListModels permission." : "";
    throw new Error(`Mantle model discovery returned HTTP ${response.status}.${permission}`);
  }
  let body;
  try { body = await response.json(); }
  catch {
    signal.throwIfAborted();
    throw new Error("Mantle model discovery returned invalid JSON.");
  }
  signal.throwIfAborted();
  validateMantleModelEntries(body?.data);
  if (body.has_more || body.next_token || body.nextToken) {
    throw new Error("Mantle model discovery returned an unsupported paginated list; refusing a partial catalog.");
  }
  return body.data;
}
