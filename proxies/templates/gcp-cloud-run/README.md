# Fingerly first-party proxy for Google Cloud Run

A dependency-free Node 20+ service (`server.mjs`, `node:http` and the global
`fetch`) that your External Application Load Balancer routes one path to. It
answers the path the Fingerly dashboard issued, on your own domain, and
forwards only the browser SDK's submissions to the Fingerly API. It is not an
open proxy: the upstream is a constant in the code, and every other path and
method is refused.

## Steps

1. In the dashboard, open **Integration > Proxy keys**, create a proxy and copy
   the key it shows once. Note the path it issued, such as `/k7x2qm4a`.
2. Store the key in Secret Manager and let the service's runtime service
   account read it:

   ```sh
   printf '%s' 'fly_px_production_...' | gcloud secrets create first-party-relay-key --data-file=-
   gcloud secrets add-iam-policy-binding first-party-relay-key \
     --member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com \
     --role=roles/secretmanager.secretAccessor
   ```

3. Deploy from this folder. Buildpacks build it from `package.json`; no
   Dockerfile is needed. The ingress setting means only your load balancer can
   reach it:

   ```sh
   gcloud run deploy site-relay --source . --region=europe-west1 \
     --ingress=internal-and-cloud-load-balancing --allow-unauthenticated \
     --set-env-vars=FINGERLY_PATH=/k7x2qm4a \
     --set-secrets=FINGERLY_PROXY_KEY=first-party-relay-key:latest
   ```

4. Give your load balancer a serverless NEG and a backend service for it. Use
   the load balancing scheme your load balancer already uses (`EXTERNAL_MANAGED`
   for the global external Application Load Balancer, `EXTERNAL` for the
   classic one):

   ```sh
   gcloud compute network-endpoint-groups create site-relay-neg \
     --region=europe-west1 --network-endpoint-type=serverless \
     --cloud-run-service=site-relay
   gcloud compute backend-services create site-relay-backend \
     --global --load-balancing-scheme=EXTERNAL_MANAGED
   gcloud compute backend-services add-backend site-relay-backend \
     --global --network-endpoint-group=site-relay-neg \
     --network-endpoint-group-region=europe-west1
   ```

5. Route the path to it in the URL map that serves your site. If your host has
   no path matcher yet:

   ```sh
   gcloud compute url-maps add-path-matcher URL_MAP --global \
     --path-matcher-name=site --default-service=YOUR_SITE_BACKEND \
     --new-hosts=www.example.com --path-rules=/k7x2qm4a=site-relay-backend
   ```

   If it has one, export the map, add a rule to that path matcher and import
   it back:

   ```sh
   gcloud compute url-maps export URL_MAP --global --destination=url-map.yaml
   #   pathRules:
   #   - paths:
   #     - /k7x2qm4a
   #     service: projects/PROJECT_ID/global/backendServices/site-relay-backend
   gcloud compute url-maps import URL_MAP --global --source=url-map.yaml
   ```

   In the console: **Load balancing > your load balancer > Edit > Routing
   rules**, add the path `/k7x2qm4a` with backend `site-relay-backend`.
6. Point the browser SDK at the path:

   ```ts
   await load({
     apiKey: 'fly_pk_production_...',
     endpoints: '/k7x2qm4a',
     consent: 'granted', // only once the visitor has agreed, or you have another lawful basis
   })
   ```

## How the visitor's address is trusted

The load balancer appends `<client-ip>,<load-balancer-ip>` to
`X-Forwarded-For` and does not vouch for anything before them. The service
sends the second-to-last entry as `x-fingerly-client-ip`, so entries a visitor
writes on the left are ignored. That is its default client address source,
`xff:2`; `FINGERLY_CLIENT_IP_SOURCE` overrides it (`remote`, `header:<name>`
or `xff:<n>`) if you put something else in front. This holds only while every request arrives
through the load balancer, which is what
`--ingress=internal-and-cloud-load-balancing` enforces. If another proxy sits
in front of the load balancer, the second-to-last entry is that proxy.

Firebase Hosting rewrites to Cloud Run are not supported yet: Firebase
documents no client address header for Cloud Run that a visitor cannot forge.

## What it sends and relays

Upstream, to `https://api.fingerly.io/api/v1/ingest` only, on headers built
from scratch: `content-type`, `x-api-key`, `idempotency-key` when present, and
the `x-fingerly-*` headers the service sets itself (the proxy key, the client
address, the page origin, the user agent and
`x-fingerly-proxy-version: gcp-cloud-run/1.0.0`, which the dashboard shows per
proxy). Cookies, `Authorization` and any `x-fingerly-*` header a visitor forges
never leave. Bodies over 1 MiB are refused with `413`, redirects are not
followed, and a missing or malformed key answers `503` rather than forwarding.
With `FINGERLY_PATH` unset the service answers `404` to everything.

Back to the page: the API's status and body with only `content-type`,
`x-request-id`, `ratelimit-limit`, `ratelimit-remaining` and `retry-after`,
plus `cache-control: no-store`. Nothing relayed names Fingerly.

`server.mjs` is the same file the `container` template ships; only its
`PRESET` line differs.
