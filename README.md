# pi-aws-bedrock-mantle

Local Pi provider for **GPT-6 Astra on Amazon Bedrock Mantle**, using short-lived IAM credentials and SigV4. Provider ID: `aws-bedrock-mantle`. Model ID: `openai.gpt-6-astra`. Tested with Pi 1.3.0 and Node 24.

## Design

Pi's existing `openai-responses` implementation handles message conversion, tool calls, image-valued function outputs, reasoning, usage, stream events, cancellation, and request/response hooks. This extension supplies a signing `fetch` implementation. There is no local HTTP proxy, background process, model-discovery request, bearer-token requirement, or port configuration.

Requests go directly to `https://bedrock-mantle.<region>.api.aws/openai/v1/responses`, signed for service `bedrock-mantle`. Only POST to that exact regional route is accepted; other hosts/paths/query strings and redirects are rejected. Placeholder bearer authentication is stripped and replaced with SigV4. Images remain `input_image` data URLs inside `function_call_output.output` where Pi puts them. No Converse rewriting or image dropping is needed.

Astra is explicitly configured with text/image input, reasoning, a 1,050,000-token context and 128,000-token output limit. The extension does not guess support for other models/APIs, expose server-side tool features, or implement background Responses/retrieval. Prices are standard regional rates from the AWS model card and are estimates, not billing records.

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

The selected profile uses the AWS SDK `fromIni` provider, including credential_process, SSO and role assumption. With no selected profile, the standard Node AWS credential chain is used. Credential resolution is shared across concurrent calls, cached for at most 60 seconds, refreshed before expiration, and never cached on failure. Expired credentials are rejected. Your existing credential helper (for example `ada`) must be available on the agent process's PATH; renew upstream SSO/federation as usual. Required IAM access includes `bedrock-mantle:CreateInference` and model entitlement. The extension does not modify IAM policies.

`/mantle-status` reports the endpoint/profile without credentials. Availability in the model picker means the provider is configured, not that every future credential refresh or model-access check will succeed. Config/env changes take effect on `/reload` or the next process; no credentials or prompt bodies are logged by the extension.

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

Offline tests cover exact image payload preservation (including parallel tool results), signing scope and hash, removal of bearer/cookie headers, endpoint/redirect confinement, cancellation, unbuffered streaming, error propagation, credential refresh/coalescing, configuration precedence, and preservation of Pi instrumentation hooks. Test credentials are synthetic.

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

The vision fixture produces a generated red PNG, never a screenshot or a user file. Its payload hook prints only the image-block count and nesting, not bytes/prompts/credentials. Verified live via Pi: `MANTLE_OK`, followed by a tool-returned image with correct `Red` output. Also verified a fresh Paseo Pi launch with Astra: `PASEO_MANTLE_OK`.

## References

- [AWS Astra model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-astra.html)
- [AWS Mantle Responses](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-responses-api.html)
- [OpenAI function outputs with images](https://developers.openai.com/api/docs/guides/function-calling?api-mode=responses)
- [Pi custom providers](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md)
- [Paseo provider configuration](https://paseo.sh/docs/custom-providers)
