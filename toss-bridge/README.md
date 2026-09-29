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

## Google Cloud deployment

Open Google Cloud Shell, clone this repository, and run `bash infra/google-cloud/deploy-toss-bridge.sh`. The script requires an explicit cost confirmation, reads the Toss secret without terminal echo, stores both Toss credentials in Secret Manager, and deploys through Direct VPC egress plus a manually reserved Cloud NAT IP. It prints only the Cloud Run URL and the fixed IP that must be allowlisted in the Toss developer console.

After the fixed IP is registered with Toss, set the printed `TOSS_BRIDGE_URL` as the public value in `v4/runtime-config.ts`, rebuild, run the release QA, and deploy GitHub Pages. Never put the Toss Client ID, Client Secret, or access token in `v4`, GitHub Pages, a commit, an issue, or chat.
