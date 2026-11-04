Call `getDeepSeekBalance()` to display the saved DeepSeek account's balance in Settings.
The backend, helper and Settings display are included in the signed 1.0.4 release.

```js
import { getDeepSeekBalance } from './read/llm.mjs'; // From a module in web/.
const balance = await getDeepSeekBalance();
const refreshed = await getDeepSeekBalance({ forceRefresh: true });
// Native equivalent: window.top.Capacitor.Plugins.Llm.getDeepSeekBalance({ forceRefresh: true })
```

The native request uses `GET https://api.deepseek.com/user/balance` with the saved API key.
The [official DeepSeek protocol](https://api-docs.deepseek.com/api/get-user-balance/) returns account
availability and balances. No completion is generated, and this read does not increment the app's
sentence-request or token counters. JavaScript never receives a key or supplies a destination.

## Response, schemaVersion 1

This example is illustrative, not a live account observation:

```json
{
  "schemaVersion": 1,
  "provider": "deepseek",
  "isAvailable": true,
  "balanceInfos": [
    {
      "currency": "CNY",
      "totalBalance": "110.00",
      "grantedBalance": "10.00",
      "toppedUpBalance": "100.00"
    }
  ],
  "observedAt": 1793685804000,
  "expiresAt": 1793685864000,
  "cached": false
}
```

`totalBalance` includes the unexpired granted balance and topped-up balance. All amounts remain
decimal strings to preserve their precision. Display their currency (`CNY` or `USD`); keep separate
currency rows rather than summing them. `isAvailable` is the provider's indication of sufficient
balance for API use, not a model-health check. Zero, negative balances and `isAvailable: false` are
valid successful responses. An empty `balanceInfos` array means no balance row was supplied; do not
invent a zero balance. Unknown/malformed amounts reject rather than appearing as zero.

`observedAt` and `expiresAt` are Unix milliseconds. A successful observation is cached in process
memory for 60 seconds, scoped to a fingerprint of the saved key. A normal read during that interval
has `cached: true`. `forceRefresh: true` bypasses the saved snapshot; concurrent refreshes of the
same account join the current request. Editing configuration or clearing the key invalidates the
snapshot. A reply from a request whose saved key/base changed is rejected with `CONFIG_CHANGED`.
Balances are not persisted into the 30-day sentence cache or usage ledger.

Only the official HTTPS `api.deepseek.com` origin is supported, including its `/v1` configuration
alias and normal HTTPS port. A custom OpenAI-compatible endpoint rejects with `UNSUPPORTED_PROVIDER`
without making a request. The app cannot infer a separate DeepSeek key from another provider's key.

## Failure and refresh behavior

| Code | Frontend action |
|---|---|
| `NO_API_KEY`, `INVALID_API_KEY`, `UNAUTHORIZED` | Prompt to save/update the DeepSeek key in Settings. |
| `UNSUPPORTED_PROVIDER`, `INVALID_CONFIG` | Explain that this query requires the official DeepSeek configuration. |
| `CONFIG_CHANGED` | Discard the old account result and offer a fresh query. |
| `FORBIDDEN`, `RATE_LIMITED` | Display the supplied reason and allow a later retry. |
| `TIMEOUT`, `NETWORK_ERROR`, `HTTP_ERROR`, `REDIRECT_REFUSED` | Keep any previously displayed snapshot with its timestamp and expose retry. |
| `INVALID_RESPONSE`, `BALANCE_ERROR`, `INTERNAL_ERROR` | Display a query failure; do not replace the balance with zero. |
| `NO_BRIDGE`, `CANCELLED` | The supported native plugin is unavailable or the read was interrupted. |

Native networking has 8-second connect/read inactivity timeouts, a 12-second total deadline and a
64 KiB response cap. The web helper has a 20-second guard. Redirects are refused; raw provider
failure bodies and credentials are never forwarded. Failed refreshes are not cached as balances
and are not automatically retried. Use the dedicated balance executor so local usage reads and
sentence work stay independent.

Read on Settings entry and explicit refresh; avoid continuous background polling. Show loading,
the latest observation time and a failure reason. [getUsage](usage-api.md) remains a separate local
statistics read and does not query DeepSeek balance. Mock-server tests verify amounts, unavailable
accounts, cache expiry, account changes, concurrent refreshes, sanitized failures and time bounds;
no real API key or paid completion is used for these tests. The separately authorized
[live endpoint verification](VALIDATION-1.0.4-2026-11-03.md) also passed.
