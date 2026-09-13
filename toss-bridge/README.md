# DividendOS Toss read-only bridge

This server keeps `TOSS_CLIENT_SECRET` outside GitHub Pages and exposes only account, holdings, and closed-order reads. It contains no order-create, modify, cancel, transfer, or withdrawal route.

Deploy it behind a fixed outbound IP registered in Toss Securities WTS Open API settings. Configure the environment variables from `.env.example`; Google login tokens are checked with Google's public signing certificates, so no Firebase admin credential file is needed. After deployment, set only the public HTTPS base URL in `runtime-config.js`.

Official references:

- https://developers.tossinvest.com/docs
- https://openapi.tossinvest.com/openapi-docs/latest/openapi.json
