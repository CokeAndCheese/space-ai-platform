# Tencent Lighthouse deployment — static default and explicit online AI

This runbook keeps the repository's default deployment static and AI-off. Online AI is a separate, explicit Compose override and must be deployed only from an accepted exact commit after local gates and independent review pass. Never deploy an uncommitted working tree.

## Current state (2026-09-12)

- The accepted server baseline is commit `896705773df82e009915b6f2c89cde068836b85d`. Its static container is healthy internally and contains the approved public model snapshot, but the HTTPS application path currently returns `503 pending` at the shared gateway.
- `https://115.159.223.98/space-ai-platform/health` has a publicly trusted short-lived IP certificate and succeeds. That health-only route is not evidence that the application, package import, model downloads, or AI are public.
- The full application route, root `/models/` and `/draco/`, the project API route, the LLM container, a real MiniMax call through this new chain, and the root-index card have not yet passed the final server/public acceptance for this wiring.
- Default `compose.yml` remains static: it builds with `VITE_LLM_ENABLED=false`, starts only `web`, and serves an Nginx configuration that returns 404 for API paths.
- `compose.ai.yml` is the only online-AI mode. It builds the browser with `VITE_LLM_ENABLED=true`, uses the AI Nginx template, replaces the static shared-network membership with the project-exclusive edge, and starts the private proxy only when `--profile llm` is explicitly supplied.
- The earlier bridge-only gate failed: a container attached only to shared `web` could still reach the AI web container through its known edge-network IP, even when the edge bridge was internal. Network membership alone is therefore defense in depth, not authorization. The current local candidate adds a second, independent edge token checked by the proxy before every other request control. Do not cut over online AI until the real-proxy container fixture, independent review, and actual Caddy/server checks pass.
- This repository does not contain a production provider key or service token. The server-only key has been provisioned securely, and one independent direct MiniMax-M3 smoke returned HTTP 200 with `expectedJson=true`; that call bypassed this new proxy/browser chain and is not its acceptance evidence. Never record the key or response content here.

The historical static first-release backup is `/srv/backups/space-ai-platform-first-20260909-ysDnfs/`. The TLS gateway backup is `/srv/backups/space-ai-platform-tls-20260910-piy4W9/gateway-before/`. Because the shared gateway may change after either backup, never restore an old full gateway tree blindly; compare current state and revert only this project's exact route/card delta.

## Security and product boundary

- Public application origin: `https://115.159.223.98`.
- Application path: `/space-ai-platform/`.
- Public model assets: `/models/`. Viewing a GLB permits downloading it; the user approved publication of the current model snapshot.
- Public DRACO assets: `/draco/`.
- The only browser AI endpoint is `POST /space-ai-platform/api/llm/chat/completions`. Caddy strips the project prefix, Nginx accepts only exact `/api/llm/chat/completions`, and the private proxy accepts only exact `/chat/completions`.
- Proxy `/health`, every other `/api` path, and the provider endpoint are not public routes.
- Visitors are anonymous. Exact HTTPS `Origin` checking, an edge token provisioned only to Caddy and the proxy but carried through Nginx on the exact API request, a separate Nginx-to-proxy token, a Caddy-controlled client IP, frequency/concurrency limits, and a global 100-request daily quota reduce abuse; they are not user authentication or per-person accounting.
- The daily quota uses `Asia/Shanghai`, is reserved atomically before every upstream request, survives restarts, and is not refunded after a provider attempt. Missing, corrupt, locked, unwritable, rolled-back, or uninitialized state fails AI closed while static features remain available.
- The proxy fixes `https://api.minimax.cn/v1`, `MiniMax-M3`, `service_tier=standard`, `thinking.type=disabled`, and at most 2048 completion tokens. Redirects are forbidden. Browser settings cannot replace these values.
- Provider errors and streamed diagnostics are converted to bounded generic errors. Response-body timeout, size limits, stream backpressure, required SSE completion, browser cancellation, global/per-client rate limits, and global/per-client concurrency limits are enforced server-side.
- Only `llm-proxy` receives `LLM_API_KEY`. `LLM_EDGE_TOKEN` is a strict 32–256 character base64url secret provisioned as configuration only to the Caddy runtime and `llm-proxy`; AI `web` has no edge-token environment variable, configuration field, or persistent copy. On the exact API path, however, Nginx necessarily receives that header in request memory and relays it to the proxy, so `web`/Nginx is part of the trusted computing base. `LLM_PROXY_TOKEN` is a different strict secret configured only in Nginx `web` and `llm-proxy`. The two tokens must be generated independently and must not match. Neither token belongs in Git, a Vite variable, a browser bundle, an image layer, a command argument, a response, an upstream provider request, a log, or a persistent request capture.
- In AI mode, `web` joins only the external `space-ai-platform-edge` network and the private application network; it does not join shared `web`. Only Caddy and this project's `web` may join the exclusive edge. `llm-proxy` has no host port and joins only the private application network and a dedicated egress bridge. A shared-network sibling may still reach the known edge IP on the tested Docker host, but without the independently held edge token its direct request must receive a non-2xx response before Origin, rate, concurrency, quota, or upstream work. This control prevents ordinary sibling-container forgery; it does not protect an already compromised Caddy, `web`/Nginx, `llm-proxy`, or Docker/root administrator. The application fixes the provider host and rejects redirects, but Docker networks are not an FQDN firewall; host-level egress policy remains defense in depth.
- Anyone with root/Docker access on the server can inspect runtime environments. Keep server administration access restricted and `.env.runtime` mode `0600`.

## Server layout

```text
/srv/apps/space-ai-platform/                       exact accepted-commit checkout
/srv/apps/space-ai-platform-assets/models/         approved public model snapshot
/srv/apps/space-ai-platform-data/llm-quota/         persistent quota state
/srv/backups/space-ai-platform-*/                   release and gateway rollback evidence
/srv/gateway/                                       shared Caddy gateway
```

Containers are `space-ai-platform` (`web`) and `space-ai-platform-llm` (`llm-proxy`). Default static mode keeps `web` on the shared external `web` network. AI mode uses Compose `!override` to replace that membership with external `space-ai-platform-edge`; Caddy must join that edge separately in the later server work package. Neither service publishes a host port. The model and quota mounts use `create_host_path: false`; missing directories stop deployment instead of creating empty or root-owned state.

The approved model snapshot contains 59 `.glb`/`.json` files and 327332352 bytes. Validate it against `deploy/model-assets.sha256` before every release. The server baseline uses the committed manifest SHA-256 `8c9d1b468e4e943225a40cbcff7ec77ae8470410d5f415b6d3bae2e636493818`; never copy the protected dirty working manifest (currently SHA-256 `2ed654ea23f091008e8bd91f2996077c938026ade8183dea972205997bea9fbc`) into a release.

## Release inputs and stop conditions

Required inputs:

1. An accepted local checkpoint and a verified full-history Git bundle for exactly that commit. Record the bundle SHA-256.
2. The separately verified model archive and sorted SHA-256 index. Models remain outside Git.
3. A server-only `.env.runtime` created through hidden input, owned by the verified deployment administrator (currently `ubuntu`) and mode `0600`. Recheck ownership and permissions before deployment; no particular group is assumed. Do not copy `.env.local` or print, hash, source, or render secret values.
4. Two independently generated, different 32–256 character base64url values: `LLM_EDGE_TOKEN` and `LLM_PROXY_TOKEN`. The application runtime file contains both for `llm-proxy`, but Compose configures only the proxy token in `web`'s environment. The gateway receives only the edge token through a separate server-only runtime environment; Nginx still handles that edge value transiently when it relays each exact API request. Also provide the provider key, exact `LLM_ALLOWED_ORIGIN=https://115.159.223.98`, and the non-secret fixed values shown in `.env.runtime.example`.
5. An existing quota directory owned by UID/GID 1000 with mode `0700`, followed by exactly one explicit initialization.
6. Docker Compose 2.24.4 or later and an external `space-ai-platform-edge` network whose only members at cutover are Caddy and this project's `web` container. The fixture must record machine-readable transport and HTTP status for every request. Shared-sibling DNS and known-edge-IP POSTs with missing, wrong, or repeated edge-token headers may be unreachable or non-2xx, but each observed branch and unchanged quota/upstream count must be explicit. A separate, definitely reachable edge-negative client must have no correct token in its environment, mounted files, or arguments; its missing, wrong, and repeated cases must each return HTTP 401 with counters still `0/0`. Only an independent edge-positive client may receive the synthetic token and produce HTTP 200 with counters `1/1`.

Stop without changing the public route when the commit, model digest, manifest, Compose config, secret-file permissions, quota state, fixed provider settings, protected working-tree fingerprint, application health, or existing-site regression differs from its expected value. Do not weaken HTTPS, expose a proxy port, bypass the quota, or fall back to browser credentials.

## Default static mode

The rollback-safe default remains AI-off:

```sh
sudo docker compose --env-file /dev/null -f compose.yml config --quiet
sudo docker compose --env-file /dev/null -f compose.yml up -d --build web
```

Do not add `--profile llm` or `compose.ai.yml` to a static run. Static `/api`, `/api/llm`, and `/api/llm/chat/completions` must remain 404.

## Explicit online-AI preparation

Run from the clean exact-commit checkout. The `!override` merge tag requires [Docker Compose 2.24.4 or later](https://docs.docker.com/reference/compose-file/merge/#replace-value); stop on an older or unparseable version instead of falling back to append/merge behavior. Use `config --quiet`; plain `docker compose config` can render resolved environment values and must not be captured in logs.

```sh
sudo docker compose version --short
sudo docker network inspect space-ai-platform-edge
sudo install -d -m 0700 -o 1000 -g 1000 /srv/apps/space-ai-platform-data/llm-quota
sudo docker compose --env-file .env.runtime -f compose.yml -f compose.ai.yml --profile llm config --quiet
```

If and only if inspection proves that `space-ai-platform-edge` does not exist, its creation is a separately authorized server action:

```sh
sudo docker network create --label com.space-ai-platform.network-role=edge space-ai-platform-edge
```

Resolve the accepted full 40-character commit into `SPACE_AI_EXACT_SHA`, verify it equals `git rev-parse HEAD`, then build and retain separate immutable rollback tags before starting either mode. Never use `manual` or `latest` as release evidence.

```sh
sudo env SPACE_AI_RELEASE="static-${SPACE_AI_EXACT_SHA}" docker compose --env-file /dev/null -f compose.yml build web
sudo docker image inspect "space-ai-platform:static-${SPACE_AI_EXACT_SHA}" --format '{{.Id}}'
sudo env SPACE_AI_RELEASE="ai-${SPACE_AI_EXACT_SHA}" SPACE_AI_EDGE_NETWORK=space-ai-platform-edge docker compose --env-file .env.runtime -f compose.yml -f compose.ai.yml --profile llm build web llm-proxy
sudo docker image inspect "space-ai-platform:ai-${SPACE_AI_EXACT_SHA}" --format '{{.Id}}'
sudo docker image inspect "space-ai-platform-llm:ai-${SPACE_AI_EXACT_SHA}" --format '{{.Id}}'
```

Record each tag-to-image-ID mapping in the release evidence. A missing tag, non-40-hex release identifier, or image ID that changes before cutover is a stop condition.

Initialize the quota only when `daily.json` does not yet exist. The initializer uses exclusive creation and intentionally fails rather than overwriting an existing state. Never remove or reinitialize the file to restore allowance.

```sh
sudo env SPACE_AI_RELEASE="ai-${SPACE_AI_EXACT_SHA}" SPACE_AI_EDGE_NETWORK=space-ai-platform-edge docker compose --env-file .env.runtime -f compose.yml -f compose.ai.yml --profile llm run --rm --no-deps llm-proxy node --input-type=module --eval "import { initializeDailyQuota, loadDailyQuotaConfig } from './server/llm-quota.mjs'; await initializeDailyQuota(loadDailyQuotaConfig())"
sudo env SPACE_AI_RELEASE="ai-${SPACE_AI_EXACT_SHA}" SPACE_AI_EDGE_NETWORK=space-ai-platform-edge docker compose --env-file .env.runtime -f compose.yml -f compose.ai.yml --profile llm up -d --no-build --pull never web llm-proxy
```

The one-off command contains no credential value, but it loads the server env file. Its expected result is success only on first initialization; an existing state is a stop signal, not a reason to delete it. Start-up health reads quota state without spending a request.

## Shared Caddy route

Back up and compare the live Caddyfile, gateway runtime definition, and complete root-site data first. A later server work package must connect only `caddy-gateway` to `space-ai-platform-edge`, confirm the edge contains exactly Caddy and `space-ai-platform`, and reject any unexpected member before routing. The gateway must receive only `LLM_EDGE_TOKEN`, never the provider key, proxy token, or complete application runtime file.

Caddy's `header_up Field value` replacement overwrites all inbound values for that field. Use the runtime placeholder `{env.LLM_EDGE_TOKEN}`; never use the parse-time environment expansion `{$LLM_EDGE_TOKEN}`, which could place the secret into an uploaded Caddyfile or adapted configuration. The exact API handler must strip only `/space-ai-platform`, preserve `/api/llm/chat/completions` for Nginx, and overwrite the edge token, client IP, and HTTPS indicator. The generic application handler explicitly removes both token headers:

```caddyfile
redir /space-ai-platform /space-ai-platform/ 308

handle /space-ai-platform/api/llm/chat/completions {
    uri strip_prefix /space-ai-platform
    reverse_proxy space-ai-platform:80 {
        header_up X-Space-Client-IP {http.request.remote.host}
        header_up X-Forwarded-Proto https
        header_up X-Space-Edge-Token {env.LLM_EDGE_TOKEN}
        header_up -X-Space-Proxy-Token
    }
}

handle_path /space-ai-platform/* {
    reverse_proxy space-ai-platform:80 {
        header_up X-Space-Client-IP {http.request.remote.host}
        header_up X-Forwarded-Proto https
        header_up -X-Space-Edge-Token
        header_up -X-Space-Proxy-Token
    }
}

handle /models/* {
    reverse_proxy space-ai-platform:80
}

handle /draco/* {
    reverse_proxy space-ai-platform:80
}
```

Merge these field deletions into both existing logger scopes: the global `log default` used for runtime/error events and the site access-log `log`. Preserve each logger's current output, level, include/exclude, hostname, and wrapper configuration; do not create a second global logger, global options block, or conflicting site `log` directive. The following are filter fragments, not replacement logger configurations:

```caddyfile
{
    log default {
        format filter {
            wrap json
            fields {
                request>headers>X-Space-Edge-Token delete
                request>headers>X-Space-Proxy-Token delete
            }
        }
    }
}

log {
    format filter {
        wrap json
        fields {
            request>headers>X-Space-Edge-Token delete
            request>headers>X-Space-Proxy-Token delete
        }
    }
}
```

Keep global debug logging disabled, but do not treat that as sufficient: global ERROR entries can still carry request headers, so both filters are mandatory. Never add custom header logging. Review the official Caddy documentation for [`header_up`](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers), [runtime and parse-time environment forms](https://caddyserver.com/docs/caddyfile/concepts#environment-variables), and [`log` filter deletion](https://caddyserver.com/docs/caddyfile/directives/log#filter). A plain Caddy reload does not update the environment of an existing process. Provisioning or rotating the edge token may therefore require a controlled gateway container recreation after backup, config validation, and an explicit server authorization; that effect and every existing site must be tested before cutover.

Never forward an inbound `X-Space-Client-IP` unchanged. Do not reconnect AI `web` to shared `web`, expose `space-ai-platform-llm`, add a root `/api/llm` route, or route proxy health. Preserve all existing HTTP/HTTPS sites and publish the complete maintained root `site/` directory when adding the Platform card; do not hardcode counters into `index.html`.

## Verification order

1. Verify exact release commit, clean server checkout, bundle SHA, model index/bytes, committed manifest, `.env.runtime` ownership/mode without printing it, quota directory ownership/mode, and an existing valid `daily.json`.
2. `docker compose ... --profile llm ps` reports both services healthy. Confirm no host ports; AI `web` is on `space-ai-platform-edge` plus the private network and absent from shared `web`, while the proxy is only on the private and egress networks. The exclusive edge must contain exactly Caddy and this `web`.
3. Inspect image/runtime configuration without emitting environment values: the provider key is absent from the browser bundle, both images, `web`, and Caddy; `web` has only the proxy token in configuration and no persistent edge-token copy; Caddy has only the edge token in configuration; proxy runtime has the provider key and both different service tokens. Confirm the request-scoped edge header is only relayed through Nginx memory and that neither service token appears in an image layer, browser response, proxy log, Caddy access/global log, persistent request capture, or fake-upstream headers.
4. Container `web` `/health` and private proxy `/health` succeed. Repeated health checks do not change the quota count.
5. Before the Caddy route changes, run the isolated real-proxy/Nginx fixture and retain its per-request machine-readable transport/status records. The shared sibling's DNS and known-edge-IP exact POSTs with missing, wrong, and repeated edge headers may be unreachable or non-2xx; record which occurred and require fake quota/upstream counters to remain `0/0`. Then use a separate edge-network negative client that is proven reachable and has no correct token environment, mounted file, or argument: missing, wrong, and repeated cases must each return HTTP 401 and preserve `0/0`. Finally, a distinct positive client supplies the synthetic edge token, relies on Nginx to overwrite the proxy token, returns HTTP 200, and changes the counters exactly to `1/1`. Neighboring API paths stay 404 without changing either count. These fixture-only clients replace production Caddy in this test topology and are not actual Caddy acceptance; production edge membership remains exactly Caddy plus `web`.
6. Validate and safely apply Caddy only after a compare-and-swap check of live files and runtime definition. Confirm the exact API route uses `{env.LLM_EDGE_TOKEN}`, `X-Space-Client-IP` uses the actual remote peer, visitor values are overwritten, both token fields are deleted from the global default/error logger and the site access logger, and debug/custom-header logging is absent. Preserve the existing logger configuration rather than adding duplicate loggers. If the edge-token environment changes, verify the authorized Caddy recreation path; a config reload alone does not prove that the running process received it.
7. From outside the server, validate the trusted certificate and exact origin. Check title/HTML marker, built JS/CSS, `/draco/`, one GLB HEAD and byte range, package import in a real browser secure context, and `/space-ai-platform/api/llm/chat/completions` while neighboring/root API paths remain unavailable.
8. Make at most the separately authorized bounded real MiniMax smoke call with synthetic content. Record only HTTP status, success boolean, duration, and non-sensitive usage numbers; never record the key, Authorization header, prompt response, provider diagnostic, or browser service token. Confirm it consumes exactly one daily reservation.
9. Exercise 100/day rejection, frequency/concurrency rejection, provider timeout, streaming DONE/truncation, and client disconnect using controlled fixtures rather than spending real requests. A provider or quota failure must affect AI only, not static UI/models.
10. Add the root card only after the complete public application passes. Re-run every existing public HTTP/HTTPS route and verify the root card/count.

Local evidence is necessary but not public acceptance. The wiring tests use fake upstreams and fake keys. A separate isolated Nginx check passed 10/10 with synthetic assets and a fake proxy (env substitution, config syntax, exact API route, header/token boundary, 64 KiB limit, static assets/range/SPA/security headers); it did not run the real application, Caddy, quota store, MiniMax, or server deployment. The updated real-proxy/Nginx container fixture separates a reachable no-secret negative client from the token-bearing positive client and emits transport/status records, but its post-update Docker result must be recorded by the authorized executor. A separate real Caddy 2.11.4 plus fake-backend fixture passed 13/13: runtime `{env.LLM_EDGE_TOKEN}` remained unexpanded in adapted JSON, exact prefixed POST/path stripping and visitor edge/proxy/IP/proto header replacement passed, neighboring/root API paths stayed 404, transport failure became 502 without exposing either fake token through the global default/error or site access logger, and SSE delivered its first chunk immediately and propagated client cancellation. The fixture's `result.json` records the updated result. It did not include real Nginx, proxy, quota, TLS, cloud state, or provider traffic, and it does not replace the real-proxy container fixture or later server acceptance. A separate immutable rollback fixture passed 8/8, switching from AI image ID `sha256:44df57e6606754cb814e431d07f04da73268d33d5c60e2547b1f35f4e0be782e` to retained static image ID `sha256:05415e914a7cde29aec321d159b3129ac5ace75d72ced2e40a75d9529b38513e` with `--no-build --pull never --no-deps`; health/UI returned 200, API routes returned 404, the static container had no key/token/host port, and the fake proxy was then stopped. That fixture used synthetic local resources, not real Caddy, MiniMax, server quota data, or a deployed commit.

## Stale quota lock recovery

`daily.json.lock` is an empty directory used as the reservation mutex. Never remove it automatically, infer staleness from age, overwrite `daily.json`, or reset its count. Recovery is a separately approved operational action:

1. Stop `space-ai-platform-llm` and prove that no project proxy, Compose one-off initializer, quota inspector, or other process using the same quota path is running. If the holder is uncertain, stop and preserve the lock.
2. Record filesystem metadata for `daily.json` and `daily.json.lock` without printing the state body. Both the state parent and lock must be real directories/files rather than links; `daily.json` must remain a regular `0600` file.
3. With the retained exact AI image, run only `createDailyQuota(loadDailyQuotaConfig()).inspect()` in a finished one-off container. It must validate schema/version/date/count/time-zone and reject clock rollback without writing state or calling the provider. Any failure stops recovery.
4. Confirm the exact `daily.json.lock` path is a real, empty directory. Any entry, link, unexpected type, or ownership ambiguity stops recovery and is escalated with metadata only.
5. Remove only that verified empty directory with `rmdir`; never use recursive deletion. Reinspect the unchanged state file, then start the retained proxy image with `--no-build --pull never --no-deps`.
6. Check the proxy's read-only health first. Only after health succeeds may a separately authorized bounded call be made; that call consumes quota normally.

Example commands intentionally avoid reading or printing the state body:

```sh
sudo env SPACE_AI_RELEASE="ai-${SPACE_AI_EXACT_SHA}" SPACE_AI_EDGE_NETWORK=space-ai-platform-edge docker compose --env-file .env.runtime -f compose.yml -f compose.ai.yml --profile llm stop llm-proxy
sudo docker inspect space-ai-platform-llm --format '{{.State.Running}}'
sudo stat --format='%F %a %U:%G %s %n' /srv/apps/space-ai-platform-data/llm-quota/daily.json /srv/apps/space-ai-platform-data/llm-quota/daily.json.lock
sudo find /srv/apps/space-ai-platform-data/llm-quota/daily.json.lock -mindepth 1 -maxdepth 1 -print -quit
sudo env SPACE_AI_RELEASE="ai-${SPACE_AI_EXACT_SHA}" SPACE_AI_EDGE_NETWORK=space-ai-platform-edge docker compose --env-file .env.runtime -f compose.yml -f compose.ai.yml --profile llm run --rm --no-deps llm-proxy node --input-type=module --eval "import { createDailyQuota, loadDailyQuotaConfig } from './server/llm-quota.mjs'; await createDailyQuota(loadDailyQuotaConfig()).inspect()"
sudo rmdir -- /srv/apps/space-ai-platform-data/llm-quota/daily.json.lock
sudo env SPACE_AI_RELEASE="ai-${SPACE_AI_EXACT_SHA}" SPACE_AI_EDGE_NETWORK=space-ai-platform-edge docker compose --env-file .env.runtime -f compose.yml -f compose.ai.yml --profile llm up -d --no-build --pull never --no-deps llm-proxy
```

The `find` command must produce no entry before `rmdir`. Preserve the pre-recovery metadata in the incident record. This procedure has not been exercised against the real server quota directory.

## Rollback

Before rollout, record the accepted commit, static and AI image IDs, quota-state metadata (never its contents), gateway/config hashes, and the current root-site snapshot. Keep `.env.runtime`, model assets, and quota state in place during rollback.

If AI fails but the retained static image is known-good, first compare its tag to the recorded image ID. A missing or changed ID stops rollback; do not build or pull during the incident. Restore `web` from the explicit static tag, verify health/UI and API 404, then stop the proxy:

```sh
sudo docker image inspect "space-ai-platform:static-${SPACE_AI_EXACT_SHA}" --format '{{.Id}}'
sudo env SPACE_AI_RELEASE="static-${SPACE_AI_EXACT_SHA}" docker compose --env-file /dev/null -f compose.yml up -d --no-build --pull never --no-deps web
sudo env SPACE_AI_RELEASE="ai-${SPACE_AI_EXACT_SHA}" SPACE_AI_EDGE_NETWORK=space-ai-platform-edge docker compose --env-file .env.runtime -f compose.yml -f compose.ai.yml --profile llm stop llm-proxy
```

This returns `web` to the default AI-off image and makes API paths 404. Do not delete or reset `daily.json`; preserving spent quota prevents rollback/redeploy from restoring allowance.

If application or gateway verification fails, compare current shared state, remove only this project's new route/card delta, reload Caddy, and restore the recorded application image/commit. Never remove the model directory, quota directory, shared `web` network, gateway volumes, TLS storage, or another site's files. After rollback, re-run every pre-existing public route.

## Source delivery and automation status

This online wiring is local source work until the product manager accepts it, creates an exact local checkpoint, the user completes the separately authorized source delivery, and independent QA passes. It does not by itself update GitHub or the server. Push-to-deploy, repository Secrets, a dedicated CI key, limited server authorization, and an end-to-end automated rollback remain unproven and are not prerequisites for the documented manual exact-commit deployment.

The prior static upload-preparation and server evidence remains historical evidence for baseline `896705773df82e009915b6f2c89cde068836b85d`; it must not be reused as proof that the new AI override, dependency fixes, HTTPS application route, browser flow, quota initialization, real provider path, or rollback has passed.
