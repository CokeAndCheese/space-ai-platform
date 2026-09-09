# Tencent Lighthouse deployment — static first release

On 2026-09-09 the user authorized replacing the code on GitHub `main` with this local candidate, while retaining the old remote history. The source repository is `https://github.com/CokeAndCheese/space-ai-platform`. Preserve remote checkpoint `61cdaebebad4a9754239384fcc40114fb0c8206f` as a merge parent / rollback point; use an ordinary push, never a force push. The user performs the push and confirms completion before any live-server change.

Read-only server inspection found no Space AI Platform checkout, container, model snapshot or Caddy route. This is the first server deployment, not an update of a running Platform container. The preparation checkpoint is not evidence of deployment, local `main` integration, or three-product compatibility approval.

## Public and private boundaries

- Public application: `http://115.159.223.98/space-ai-platform/`.
- Public model assets: `/models/`; viewing a GLB necessarily permits downloading it.
- Public DRACO assets: `/draco/`.
- The default runtime uses `deploy/nginx.static.conf`, which has no proxy route and returns 404 for `/api` and `/api/*`, including the project-prefixed variants after Caddy strips the prefix.
- Compose locks the browser build to `VITE_LLM_ENABLED: "false"`; setting `SPACE_AI_LLM_ENABLED=true` does not enable this release. Default Compose starts only `web` and passes no runtime credentials to it.
- Original `deploy/nginx.conf`, the `llm` profile and proxy implementation are retained as inactive, unapproved future-AI material. Enabling that profile alone does not turn this static release into an AI service. Public AI requires a separately approved and verified HTTPS/authentication/rate-control release.
- `.env.runtime` is server-only, mode `0600`, ignored by Git and excluded from Docker build context. Never copy `.env.local` wholesale.

## Server layout

```text
/srv/apps/space-ai-platform/                 exact-commit checkout
/srv/apps/space-ai-platform-assets/models/   public model asset snapshot
/srv/backups/space-ai-platform-*/             release rollback records
/srv/gateway/                                 shared Caddy gateway
```

The application container is `space-ai-platform`; the inactive internal proxy profile names `space-ai-platform-llm`. Only the application joins the external Docker network `web`. The retained proxy profile uses the project-private `llm-internal` network with no host ports. The default static Nginx neither injects tokens nor reaches the proxy. A missing model directory is an error (`create_host_path: false`), not an automatically created empty model library.

## Manual release inputs

1. User confirmation that the exact release commit exists on GitHub, independently verified before server changes; a verified full-history Git bundle delivering that same commit inbound over SSH.
2. The bundle SHA-256.
3. A separate `public/models` archive and a sorted per-file SHA-256 index.
4. No `.env.runtime`, provider key or proxy token is required for the default static release. Do not read, migrate or upload local credentials.

The asset snapshot is independent of Git: 59 `.glb`/`.json` files, 327332352 bytes, checked against `deploy/model-assets.sha256` (SHA-256 `35972091e31db031f1ccf60f4c34940156f3236afef178d644cb41eec0186212`). Index paths are relative to `public/` locally and `/srv/apps/space-ai-platform-assets/` on the server. Use the committed model manifest (SHA-256 `8c9d1b468e4e943225a40cbcff7ec77ae8470410d5f415b6d3bae2e636493818`); do not upload the protected dirty working-copy manifest.

The release must stop if the checkout is dirty, the bundle target differs from the expected commit, a model hash differs, Compose validation fails, or the pre-deployment manifest/Git snapshots change.

## Gateway routes

For the current HTTP-only static release, add routes only after the application container is healthy on `web`:

```caddyfile
redir /space-ai-platform /space-ai-platform/ 308

handle_path /space-ai-platform/* {
    reverse_proxy space-ai-platform:80
}

handle /models/* {
    reverse_proxy space-ai-platform:80
}

handle /draco/* {
    reverse_proxy space-ai-platform:80
}
```

Do not add an HTTP `/api/llm` route. Before changing the gateway, compare the live configuration and root-index data and back up both. Preserve every existing route and project record. Append the Platform card to `site/assets/site-data.js` and publish the complete maintained `site/` directory; do not hardcode a card or counter in `index.html`.

After the uploaded commit and separate model snapshot are verified, validate and start only the static service in the clean server checkout:

```sh
sudo docker compose --env-file /dev/null config --quiet
sudo docker compose --env-file /dev/null up -d --build web
```

Never print a rendered environment section containing credentials. Preserve the existing root `/models/` and `/draco/` URLs required by the application; only claim public readiness after those assets and the project-prefixed built JS/CSS have passed HTTP verification.

## Verification order

1. `sudo docker compose --env-file /dev/null ps` reports `web` healthy, with no LLM service started.
2. Container `/health` succeeds.
3. Confirm no project host port is published and only the static container is reachable by Caddy on `web`.
4. From the application container, `/api`, `/api/llm` and `/api/llm/chat/completions` return 404.
5. Caddy can resolve and reach only the application container on `web`.
6. Loopback and the public application URL return the expected title.
7. Built JS/CSS, `/draco/`, and a GLB HEAD plus byte range succeed.
8. Do not call a real LLM provider in this static deployment.
9. Public root and project-prefixed API paths remain unavailable; HTTP 200 containing the SPA is not evidence of an AI service.
10. Root index card/count and every existing public route still work.

## Rollback

Before changing the gateway, save a timestamped copy of its Caddyfile and complete `site` directory. Before an application update, record the current commit and image IDs.

On failure, restore the gateway backup and reload Caddy, then restore the previous exact commit/image and re-run health checks. For the first release, remove only this project's route/card and stop only its Compose application. Never delete the model asset directory, volumes, shared `web` network, gateway or another project's files.

## Automation — pending first-deployment setup

The current upload handoff does not install or prove push-to-deploy. After the user confirms upload, the first-deployment stage must prepare the repository-specific Actions workflow, dedicated CI key (never the Mac personal key), pinned server host key, limited server authorization and one-time repository Secrets setup. Do not claim automatic deployment before an end-to-end push has succeeded.

Required workflow behavior: `main` push, read-only repository permission, complete-history exact-commit Git bundle sent inbound over SSH, per-project concurrency with `cancel-in-progress: false`, and a server-side release lock. Reject dirty checkouts, a target different from the triggering commit and non-fast-forward updates. Validate model hashes and Compose without logging secrets; record old commit/image, rebuild only this application, verify container/network/public content, and restore the recorded checkout/image on failure. Do not fetch from GitHub on the server, modify shared gateway data on ordinary pushes, delete volumes or run implicit data migrations.

## Upload-preparation evidence (2026-09-09)

- Input application checkpoint: `44e305a4bf4b30d4ec87025ead02a194c16dacc7`; existing deployment changes were reviewed individually. Source/contract code is unchanged except the reviewed browser AI-off and Vite deployment-base changes.
- `npm run verify:r1`: 10/10 gates PASS, including topology 10, sidecar 18, legacy lifecycle 27, Quick Action 22, templates 20, three audits, typecheck and production build. Working manifest SHA stayed `2ed654ea23f091008e8bd91f2996077c938026ade8183dea972205997bea9fbc`; full Git porcelain SHA stayed `2f2322197307b085b7b23eb86fa3e93943459591ff749d0261877d428aacc77a` during that run.
- Package v1/v2 parser 35/18, lifecycle 13/8, Home import 13 and capability gate 9 also passed against the unchanged application checkpoint.
- `npm run test:llm-proxy`: 10/10 PASS using loopback fake upstream only, no real provider or credentials. `npm run test:deployment`: static wiring and 59-asset digest/size checks PASS.
- `docker compose --env-file /dev/null config --quiet` PASS. Parsed default config contained only `web`, no credentials or host ports, AI=false even with `SPACE_AI_LLM_ENABLED=true`, and an existing read-only model bind mount requirement.
- A temporary export of the exact staging index (not a Git worktree), with the committed manifest and no local environment files, passed `npm run build` under Node 22. Built asset URLs use `/space-ai-platform/`; the disabled-AI marker is present. Common secret-pattern scans of staged text, new local history and built JS reported no matches; these are bounded scans, not a guarantee that arbitrary sensitive data cannot exist.
- Official Docker Hub tag APIs confirmed and supplied the pinned Node 22 Alpine and Nginx 1.30.4 Alpine digests in `Dockerfile`. The local Docker daemon was unavailable: container build/start, Nginx HTTP behavior, server assets, gateway/card, public URL and CI end-to-end are **not** covered by the local gates. Vite still reports chunks above 500 kB.
