# pi-aws-bedrock-mantle

Local Pi provider for **Amazon Bedrock Mantle**, with live model discovery, short-lived IAM credentials and SigV4. Provider ID: `aws-bedrock-mantle`. Tested with Pi 1.3.0 and Node 24.

## Design

The extension calls `GET https://bedrock-mantle.<region>.api.aws/v1/models` using IAM SigV4, then matches the returned IDs against the host Pi's bundled `amazon-bedrock` catalog. There is no hardcoded model list or Astra fallback. Discovery always uses `/v1/models`, not `/openai/v1/models` (which returns 404).

The API lists model IDs and availability, but not context/output limits, input capabilities or pricing. Those fields come from Pi's Bedrock catalog. Exact IDs are preferred; regional prefixes and Bedrock version suffixes are normalized, and Claude's undated aliases can match dated catalog IDs. Unknown IDs and unsupported API families are skipped rather than assigned invented limits. `/mantle-status` reports skipped IDs. Updating Pi can add missing metadata; this extension does not scrape model cards at startup or use prices from other providers. Prices are estimates, not billing records. API-specific Converse compatibility flags and image limits are not copied to Mantle.

Pi's existing streaming implementations handle message conversion, tool calls, images, reasoning, usage, cancellation and request/response hooks:

| Discovered model family | Pi API | Mantle inference path |
| --- | --- | --- |
| OpenAI GPT, excluding GPT OSS | `openai-responses` | `/openai/v1/responses` |
| OpenAI GPT OSS (including Safeguard) | `openai-completions` | `/v1/chat/completions` |
| Claude | `anthropic-messages` | `/anthropic/v1/messages` |
| Google Gemma, xAI Grok | `openai-completions` | `/openai/v1/chat/completions` |
| DeepSeek, Mistral, Qwen, NVIDIA, Moonshot, MiniMax, Z.ai, Writer | `openai-completions` | `/v1/chat/completions` |

Chat Completions uses conservative compatibility settings: `max_tokens`, system rather than developer messages, and no `store`, strict tools or `reasoning_effort` field. A model's reasoning capability does not imply adjustable thinking effort through this adapter. Family routing is maintained separately from the discovered model list; new API families need an explicit mapping.

Requests go directly to the configured regional host, signed for service `bedrock-mantle`. The signer permits only GET discovery and POST to the inference paths above. Other hosts, methods, paths, query strings and redirects are rejected, except the Anthropic SDK's exact `?beta=true` query, which is included in the signature. Placeholder API keys and cookies are stripped. Image handling stays with Pi: Responses preserves image-valued function outputs; Messages and Chat Completions use their native conversions. No Converse rewriting, local proxy, background process, bearer token, or port configuration is needed. Background Responses/retrieval and server-side tool features are not implemented.

### Discovery lifecycle

The asynchronous extension factory waits for discovery before registration, so a fresh `pi --list-models` or `--model` launch can use the live list. Discovery has a 10-second deadline, including credential resolution. Pi's native `refreshModels` hook supports subsequent refreshes, with a one-minute freshness window; `/mantle-refresh` forces a refresh. A successful refresh replaces the list, including removing models no longer returned. A failed refresh retains the last successful in-memory list and exposes an error through `/mantle-status`.

Catalogs are **in-memory only**, scoped to this extension instance's profile and region. No discovery snapshot or AWS response body is persisted. A failed initial discovery leaves this provider with no models and prints a warning; it does not silently advertise Astra or models from another profile/region. `PI_OFFLINE` skips discovery, so a new offline process has no discovered Mantle models.

Inspired by the IAM-authentication goal of [samfoy/pi-bedrock-mantle](https://github.com/samfoy/pi-bedrock-mantle); independently implemented using direct signed fetch instead of its loopback proxy and legacy image conversion.

## Install

```sh
cd ~/repos/pi-aws-bedrock-mantle
npm ci --ignore-scripts --legacy-peer-deps
pi install "$PWD"
```

The entrypoint is TypeScript so Pi's extension loader resolves the host-provided Pi modules. Runtime dependencies are installed locally; Pi host packages are peer dependencies, not bundled copies. No build step is required.

## Configuration

Create `~/.config/pi-aws-bedrock-mantle/config.json`:

```json
{
  "profile": "chunisan",
  "region": "us-west-2"
}
```

Only non-secret `profile` and `region` fields are permitted. Do not place AWS keys or tokens here. With this file, no additional environment exports are necessary.

Supported environment variables:

| Variable | Purpose |
|---|---|
| `AWS_PROFILE` | AWS profile selector; overrides saved configuration. |
| `AWS_REGION` | Primary region selector: `us-west-2` or `us-east-1`. |
| `AWS_DEFAULT_REGION` | Region fallback when `AWS_REGION` is unset. |
| `XDG_CONFIG_HOME` | Configuration root; defaults to `~/.config`. |

Precedence: standard AWS variables → saved configuration → built-in defaults. `AWS_REGION` takes precedence over `AWS_DEFAULT_REGION`. An unsupported region causes an error, not silent rerouting. No `BEDROCK_MANTLE_*` variables are read; use `XDG_CONFIG_HOME` to select a different configuration root.

Equivalent explicit launch:

```sh
AWS_PROFILE=chunisan \
AWS_REGION=us-west-2 \
pi --model aws-bedrock-mantle/openai.gpt-6-astra
```

The selected profile uses the AWS SDK `fromIni` provider, including credential_process, SSO and role assumption. With no selected profile, the standard Node AWS credential chain is used. Credential resolution is shared across concurrent calls, cached for at most 60 seconds, refreshed before expiration, and never cached on failure. Expired credentials are rejected. Your existing credential helper (for example `ada`) must be available on the agent process's PATH; renew upstream SSO/federation as usual. Required IAM access includes `bedrock-mantle:ListModels` for discovery, `bedrock-mantle:CreateInference` for inference, and model entitlement. The extension does not modify IAM policies.

List discovered models:

```sh
pi --list-models aws-bedrock-mantle
```

Use `/model` to select one, `/mantle-status` for profile/region, discovery time, errors and skipped IDs, or `/mantle-refresh` to refresh the list. Discovery does not guarantee every subsequent inference request will succeed: model entitlement, quotas and credentials still apply. Config/env changes take effect on `/reload` or the next process; no credentials or prompt bodies are logged by the extension.

Set defaults in `~/.pi/agent/settings.json`, preserving other entries:

```json
{
  "defaultProvider": "aws-bedrock-mantle",
  "defaultModel": "openai.gpt-6-astra"
}
```

Existing sessions can retain their recorded model; select the new provider/model after `/reload`.

## Paseo

The active config on this machine is `~/.paseo/config.json` (`PASEO_HOME=~/.paseo`). `~/.config/paseo` is an alias to the same directory, not a second daemon home. Relevant provider fields:

```json
{
  "agents": {
    "providers": {
      "pi": {
        "enabled": true,
        "env": {
          "AWS_PROFILE": "chunisan",
          "AWS_REGION": "us-west-2"
        },
        "additionalModels": [
          {
            "id": "aws-bedrock-mantle/openai.gpt-6-astra",
            "label": "GPT-6 Astra (Bedrock Mantle · IAM)",
            "isDefault": true
          }
        ]
      }
    }
  }
}
```

Run `paseo reload` after editing. Changes apply to new launches, not the model already selected by existing agents. No daemon restart is required. Profile env values are non-secret; don't store resolved credentials in Paseo JSON.

## Tests

```sh
npm test
```

Offline tests cover discovery response validation, safe error messages, model matching/filtering/routing, catalog replacement and failure retention, offline/cancelled/superseded refreshes, exact image payload preservation, GET/POST signing scope and hash, removal of bearer/cookie headers, endpoint/redirect confinement, cancellation during credential resolution, unbuffered streaming, credential refresh/coalescing, configuration precedence, and preservation of Pi instrumentation hooks across all three adapters. Test credentials are synthetic.

Optional live tests (incur inference costs):

```sh
pi -ne -e ./index.ts --no-mcp -nc -ns -np --no-tools --no-session \
  --model aws-bedrock-mantle/openai.gpt-6-astra --thinking low \
  -p 'Reply with exactly MANTLE_OK.'

pi -ne -e ./index.ts -e ./test/vision-fixture.ts --no-mcp -nc -ns -np \
  --tools vision_fixture --no-session \
  --model aws-bedrock-mantle/openai.gpt-6-astra --thinking low \
  -p 'Call vision_fixture exactly once. Inspect its returned image and reply with only its dominant color.'
```

The vision fixture produces a generated red PNG, never a screenshot or a user file. Its payload hook prints only the image-block count and nesting, not bytes/prompts/credentials. It can also be run with a discovered Claude or vision-capable Chat Completions model by replacing `--model` and using `--thinking off`.

Live validation of discovery: Pi listed the catalog intersection for the configured region. Synthetic image-tool round trips passed with Astra (Responses), Claude Haiku 4.5 (Messages), and Ministral 3 3B (Chat Completions). Simple text requests also passed with GPT-5.6 Luna, GPT OSS 20B, and Gemma 4 E2B. These are representative checks, not an inference test of every discovered model.

## References

- [AWS model discovery](https://docs.aws.amazon.com/bedrock/latest/userguide/models-get-info.html)
- [Mantle IAM permissions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_bedrock-mantle.html)
- [Mantle Chat Completions](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions-mantle.html)
- [Mantle Anthropic Messages](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-messages-api.html)
- [AWS model cards and per-model routing](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html)
- [AWS Astra model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-astra.html)
- [AWS Mantle Responses](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-responses-api.html)
- [OpenAI function outputs with images](https://developers.openai.com/api/docs/guides/function-calling?api-mode=responses)
- [Pi custom providers](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md)
- [Paseo provider configuration](https://paseo.sh/docs/custom-providers)
