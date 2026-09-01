# Deployment guide

Aeroficiency is configured for managed ChatGPT Sites publishing through `.openai/hosting.json` and builds through Vinext/Vite to a worker-rendered application. The same build can be deployed directly to Cloudflare Workers as an optional alternative. It has no application database, storage bucket, login, backend API, third-party runtime call, or secret. The normal UI remains usable when WebMCP is unavailable.

## Release gate

From the repository root:

```bash
npm ci
npm run release:check
```

The gate runs lint, TypeScript, the frozen third-party-license inventory, all tests, the production build, and the high-severity dependency audit.

## ChatGPT Sites

The checked-in `.openai/hosting.json` binds the repository to a ChatGPT Sites project. Use the Sites publishing workflow only after the final account, public hostname, release commit, and owner authorization are confirmed. Before publishing, set `NEXT_PUBLIC_SITE_URL` to the final HTTPS origin and `NEXT_PUBLIC_AEROFICIENCY_COMMIT` to the frozen release commit. After publishing, open the returned URL while logged out and verify the normal workflow, assets, worker analysis, responsive layout, security headers, and supported WebMCP environment.

Deleting or replacing the bound Site can invalidate the stored project ID. Rebind `.openai/hosting.json` through the Sites workflow before the next upload rather than copying or inventing a project identifier.

## Optional direct Cloudflare Workers deployment

1. Create or sign in to a Cloudflare account and enable the default `workers.dev` subdomain. No paid plan is required for this release.
2. Authenticate Wrangler locally with `npx wrangler login`. Never commit a token or `.env` file.
3. Set the canonical production origin for the build:

   ```bash
   export NEXT_PUBLIC_SITE_URL="https://YOUR_WORKER_HOSTNAME"
   export NEXT_PUBLIC_AEROFICIENCY_COMMIT="$(git rev-parse --short=12 HEAD)"
   ```

4. Preview the generated Worker locally with `npm run preview:cloudflare`.
5. Deploy only after the public hostname and account are approved:

   ```bash
   npm run deploy:cloudflare
   ```

6. Open the returned HTTPS URL in a logged-out browser. Verify the normal workflow, all assets, worker analysis, responsive layout, security headers, and the supported WebMCP environment before using the URL in Devpost.

The build emits `dist/server/wrangler.json`; the deployment script uses that generated configuration. A custom domain is optional. The default `workers.dev` URL is a normal public website and is sufficient for a challenge submission.

## Public-release boundaries

Do not publish until all of the following are chosen or confirmed:

- the public GitHub account, repository name, author display name, and author email/privacy setting;
- the final public site hostname;
- the release commit and tag;
- the public YouTube demo URL;
- the final Devpost profile and eligibility attestations.

Never copy files from the parent challenge-planning directory into this repository. Private eligibility, credentials, correspondence, and attachment records are deliberately outside the Git root.
