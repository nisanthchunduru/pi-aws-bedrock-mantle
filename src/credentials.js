import { fromIni, fromNodeProviderChain } from "@aws-sdk/credential-providers";

export function refreshableCredentials(resolve, now = Date.now) {
  let cached;
  let refreshAt = 0;
  let pending;
  return async () => {
    if (cached && now() < refreshAt) return cached;
    if (!pending) {
      pending = Promise.resolve().then(resolve).then(credentials => {
        if (!credentials.accessKeyId || !credentials.secretAccessKey) throw new Error("AWS credential provider returned incomplete credentials.");
        const expiresAt = credentials.expiration?.getTime();
        if (expiresAt !== undefined && expiresAt <= now()) throw new Error("AWS credentials have expired; refresh the selected AWS profile.");
        cached = credentials;
        refreshAt = expiresAt === undefined ? now() + 60_000 : Math.min(now() + 60_000, expiresAt - 30_000);
        return credentials;
      }).finally(() => { pending = undefined; });
    }
    return pending;
  };
}

export function createCredentials(profile) {
  return refreshableCredentials(profile ? fromIni({ profile }) : fromNodeProviderChain());
}
