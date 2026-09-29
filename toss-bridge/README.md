# DividendOS Toss read-only bridge

This server keeps `TOSS_CLIENT_SECRET` outside GitHub Pages and exposes only account, holdings, and closed-order reads. It contains no order-create, modify, cancel, transfer, or withdrawal route.

Deploy it behind a fixed outbound IP registered in Toss Securities WTS Open API settings. Configure the environment variables from `.env.example`; `ALLOWED_FIREBASE_UID` restricts account data to one Firebase user even though the front-end login page is public. Google login tokens are checked with Google's public signing certificates, so no Firebase admin credential file is needed. After deployment, set only the public HTTPS base URL in `runtime-config.js`. The browser never receives the Toss Client ID, Client Secret, or Toss access token.

`ALLOWED_ORIGIN` accepts one to five comma-separated exact HTTPS origins. Keep it limited to the production GitHub Pages origin and an explicitly controlled preview origin when needed.

The snapshot route reads accounts, holdings, supported closed orders, and current prices. It validates and minimizes the upstream response before returning it, reports per-account partial failures, and never creates, modifies, or cancels an order. The current official API does not expose dividend deposits, so the response declares `capabilities.dividends=false` and DividendOS keeps manual dividend records.

Official references:

- https://developers.tossinvest.com/docs
- https://openapi.tossinvest.com/openapi-docs/latest/openapi.json

Reviewed against the official OpenAPI 1.2.17 document on 2026-09-28. The bridge caches the client-credentials token until shortly before expiry and retries one read once after an upstream 401; it never exposes the token response to the browser.

## Container verification

The production image runs on Node 24 as an unprivileged user and contains only the runtime package files plus `server.mjs`, `security.mjs`, and `toss-contract.mjs`. CI builds the same image, starts it with non-secret QA placeholders, and requires `/health` to report `mode: read-only` before a release can pass.

## Free on-demand import

The default personal workflow does not keep a paid server or fixed IP running. In a temporary shell, run `bash infra/toss-on-demand/export.sh`, register the displayed current IP with Toss, and enter the client credentials only into the hidden terminal prompts. The exporter writes a bounded, minimized JSON snapshot containing no Client ID, Client Secret, access token, or full account number. Import that file into DividendOS, approve the desired records, and delete the temporary JSON afterward.

The persistent bridge remains an optional deployment for environments that already have a secured fixed outbound IP. Never put the Toss Client ID, Client Secret, or access token in `v4`, GitHub Pages, a commit, an issue, an exported snapshot, or chat.
