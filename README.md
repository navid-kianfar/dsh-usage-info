# @achasoft/dsh-usage-info

Context usage and account balance for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web Client. A readout in the session header shows how full the model's context window is and what the account paying for it currently holds; clicking it opens a panel with the breakdown behind both numbers.

Balance is a swappable capability. A DeepSeek provider ships with this package; any other billing backend can implement the same seam.

## Requirements

- A dsh installation with the Web Client (`@deepseek-ai/dsh-web-app`).
- For context occupancy: nothing. It rides the token meter the harness already runs.
- For the balance: one provider, configured below. Without one, the readout still shows context occupancy and the settings card explains what is missing — an unconfigured install loses no working half.

## Install

`dsh plugin` forwards to pnpm, so any pnpm source works:

```bash
dsh plugin --profile default add @achasoft/dsh-usage-info
```

<details>
<summary>Other install sources</summary>

```bash
dsh plugin --profile default add ./achasoft-dsh-usage-info-0.1.0.tgz   # from `pnpm pack`
dsh plugin --profile default add ./dsh-usage-info                       # a local checkout
dsh plugin --profile default add github:achasoft/dsh-usage-info#<sha>   # from git
```

A git install fetches sources, not build output. This package ships a `prepare` script that builds them, but pnpm will not run it until you allow it — add the key pnpm names to your profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@achasoft/dsh-usage-info': true
```

That is permission to execute this package's code at install time. Prefer the npm or tarball forms, which need no such allowance.
</details>

The bundle appends itself to your profile automatically. Verify with `dsh --profile default --dump-config`, which should show a `# == @achasoft/dsh-usage-info` layer.

## Turn the balance on

The provider ships disabled, because no default can guess which endpoint to ask or which environment variable holds its key. Enable it from your profile's own `cordis.patch.yml` (`$DSH_HOME/profiles/<name>/cordis.patch.yml`). A patch replaces a row's entire `config`, so restate every key.

```yaml
- id: usage-info-deepseek
  disabled: false
  config:
    baseURL: https://api.deepseek.com
    apiKeyEnv: DEEPSEEK_API_KEY
    timeoutMs: 15000
```

| Field | Meaning |
|---|---|
| `baseURL` | API prefix without the `/user/balance` suffix. |
| `apiKeyEnv` | **Name of an environment variable**, never the key. Defaults to the same reference the harness's own DeepSeek adapter uses, so an installation that can already call the model can already read its balance. |
| `timeoutMs` | Deadline for one reading. |

**The key never reaches the browser.** That is the whole reason this plugin has a host half: the balance endpoint needs a bearer token, and a token shipped to a browser is a leaked token. The browser asks the host, the host asks the provider.

**The key is addressed, never stored.** `apiKeyEnv` is a credential *reference*: the value is resolved from the harness credential seam at the start of every reading and never cached, so rotating it reaches the next reading with no restart — and rotating it also drops the cached balance, because a new key can mean a different account.

Only one provider may be mounted. A composition that mounts two fails loudly at load rather than silently preferring one.

## Settings

The **Usage information** card on the plugin settings tab edits these live; the values below are the composition defaults.

| Field | Default | Meaning |
|---|---|---|
| `showContext` | `true` | Show context occupancy for the current session. |
| `showBalance` | `true` | Show the account balance. |
| `refreshIntervalMs` | `300000` | How often each browser re-asks for a balance. |
| `cacheTtlMs` | `240000` | How long one reading stays servable from the host's shared cache. |
| `lowBalanceThreshold` | *(unset)* | Exact decimal string at or below which the readout warns. Blank disables the warning. |

`refreshIntervalMs` is the poll cadence and `cacheTtlMs` is the request rate. Every open tab polls on its own timer, but a poll landing inside the cache window is answered from the host's stored reading, so the provider is asked at most once per `cacheTtlMs` no matter how many windows are open. Setting `cacheTtlMs` above `refreshIntervalMs` is refused at load: every poll would be served a reading already older than the cadence it was scheduled at.

## How it works

```
                      ┌─ contextPressure  ─┐
session projections ──┤                    ├──→ ring + breakdown bar     (no request at all)
                      └─ contextBreakdown ─┘
                                                                          session header readout
browser poll ── one unary RPC ──→ UsageInfoService.balance()               ↑
                                        │                                  │
                                   shared TTL cache ──→ ctx.accountBalance ─┴─ deepseek
```

Four decisions worth knowing:

- **The two halves arrive by different routes, on purpose.** Context occupancy is already a durable session projection the harness's token meter publishes, and every session-scoped seat receives it through the standard kit. Routing it through this plugin's endpoint would add a round trip, a second copy of the same numbers, and a way for the two copies to disagree. The balance cannot work that way, because it needs a credential.
- **Nothing here is model-facing.** No prompt, no tool, no session event. A balance reading is operator information that never enters a request, and the context figures are read from the log rather than written to it.
- **Money is never a number.** Every figure stays the exact decimal string the provider sent, from the JSON parse through the wire to the display, and the low-balance comparison is digit-wise. `0.1 + 0.2` is why: a rounding artifact in a figure a person reads as their money is a defect no display formatting can undo.
- **Failures cross the wire as values, not exceptions.** The RPC gateway erases a thrown error's classification, and the readout's next move depends on which class it was — "configure a key" is not "try again", and "this endpoint publishes no balance" means stop asking entirely, which is why a 404 halts the poll instead of retrying forever.

### What the numbers mean

Occupancy is anchored to the provider: it is the last reported prompt size plus a heuristic repricing of whatever the conversation gained or lost since that sample. That is what makes it answer for the *next* request and react the moment a compaction shortens the surface — a compaction reports no usage of its own, so the raw provider sample alone would keep showing a full context after one.

The three parts in the panel — system prompt, tool definitions, conversation — are a *composition*, not a total. They use the meter's fixed density estimate, which underprices CJK text and JSON schemas, so they will not sum to the anchored occupancy figure. Read them as proportions.

## Extending it

`ctx.accountBalance` is a capability, not a DeepSeek client. To bill against something else, implement the Service Definition this package exports and mount your plugin instead of `usage-info-deepseek`:

```ts
import { AccountBalanceProvider, BalanceError } from '@achasoft/dsh-usage-info'
import type { AccountBalance, BalanceProviderInfo } from '@achasoft/dsh-usage-info'

export class MyBalance extends AccountBalanceProvider {
  async read(signal: AbortSignal): Promise<AccountBalance> { /* … */ }
  async describe(): Promise<BalanceProviderInfo> { /* … */ }
}
```

Throw `BalanceError` with one of the capability's classified codes; every other rejection is a defect. Do not cache — the consumer owns that, because only it knows how many surfaces share one reading.

## Development

```bash
pnpm install        # builds both halves through `prepare`
pnpm run typecheck  # src, generated, and tests
pnpm test           # artifact check, then vitest
pnpm run build      # tsc emit → tsdown bundle
```

`generated/` holds the Typert RPC contract, which only the deepseek-harness generator can produce, so it ships as committed source rather than as build output. `pnpm test` refuses to pass when it drifts from `src/host/`: it compares the declared `@Remote` endpoints against the artifact's and checks a fingerprint of the Host surface. A stale artifact is not a build error but a silent wire mismatch — the browser would validate against schemas that no longer describe what the host sends.

Regenerate it against a clean harness checkout:

```bash
node scripts/regen-typert.mjs ../deepseek-harness
```

The script stages this package's host sources inside that workspace, builds the harness's Host face, copies the artifacts back, and restores everything it touched. It refuses to run against a dirty tree, and it takes several minutes.

**Run it alone.** It is the only thing in this repository that writes to the harness checkout, and it assumes exclusive access: it edits `tsconfig.base.json`, `tsconfig.host.json`, and `pnpm-lock.yaml`, then restores all three with `git checkout` in a `finally`. Two plugins regenerating at once will therefore clobber each other's staging — the second restore reverts the first's edits mid-build. Check that no other `regen-typert.mjs` is running, and that the harness tree is yours, before starting.
