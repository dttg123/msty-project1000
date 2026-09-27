# DividendOS Toss read-only bridge

This server keeps `TOSS_CLIENT_SECRET` outside GitHub Pages and exposes only account, holdings, and closed-order reads. It contains no order-create, modify, cancel, transfer, or withdrawal route.

Deploy it behind a fixed outbound IP registered in Toss Securities WTS Open API settings. Configure the environment variables from `.env.example`; `ALLOWED_FIREBASE_UID` restricts account data to one Firebase user even though the front-end login page is public. Google login tokens are checked with Google's public signing certificates, so no Firebase admin credential file is needed. After deployment, set only the public HTTPS base URL in `runtime-config.js`. The browser never receives the Toss Client ID, Client Secret, or Toss access token.

`ALLOWED_ORIGIN` accepts one to five comma-separated exact HTTPS origins. Keep it limited to the production GitHub Pages origin and an explicitly controlled preview origin when needed.

The snapshot route reads accounts, holdings, supported closed orders, and current prices. It never creates, modifies, or cancels an order.

Official references:

- https://developers.tossinvest.com/docs
- https://openapi.tossinvest.com/openapi-docs/latest/openapi.json

Reviewed against the official OpenAPI 1.2.17 document on 2026-09-28. The bridge caches the client-credentials token until shortly before expiry and retries one read once after an upstream 401; it never exposes the token response to the browser.
