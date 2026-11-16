# Changelog

## 1.0.0

- Every template answers exactly the issued path: no trailing slash, nothing
  under it, case-sensitive. The container, Cloud Run, nginx and Caddy
  templates compare the raw request target, so a doubled slash, a dot segment
  or a percent-encoded character that would clean up to the issued path is
  not forwarded.
- Every template answers 401 itself, before any upstream call, unless
  `X-Api-Key` is a `fly_pk_` key of the proxy key's environment, so a secret
  key never leaves the site. CloudFront takes the environment from
  `PUBLIC_KEY_SAMPLE`, which the dashboard fills in.
- Every template sends exactly one channel header: `X-Fingerly-Origin` when
  the request carries `Origin`, otherwise the validated
  `X-Fingerly-SDK-Platform`. A request with neither answers 400
  `missing_origin`.
- Caddy and the CloudFront function forward only the contract's client
  headers, `Sec-Fetch-*` included, so page URLs and application headers stay
  home. nginx (through an njs filter) and Caddy relay only the five
  allowlisted response headers, whatever the API adds.
- Every template answers an API redirect (`3xx`), or any status outside 200
  to 599, with 502 marked `no-store`, like the server SDK proxies, and never
  relays `Location`. CloudFront cannot replace the body in its viewer response
  function, so that body still passes.
- The Vercel, Netlify, container and Cloud Run templates read the API's answer
  whole, capped at 4 MiB and under one 5-second deadline, before relaying it:
  a timeout answers 504, and an unreachable API, a broken answer or one over
  the cap answers 502.
- The Vercel, Netlify, container, Cloud Run and CloudFront templates forward
  nothing and answer 500 ("The client IP callback returned no valid address")
  when the client IP source holds no valid address, logging it once.
- The Vercel template reads the client address only from `x-real-ip`, which
  Vercel sets itself, never from `x-forwarded-for`, which a visitor can write.
- No README or dashboard step puts the proxy key on a command line or in the
  shell history:
  - Vercel: `vercel env add FINGERLY_PROXY_KEY production --sensitive`, which
    prompts for it.
  - Netlify: the Netlify UI, with the Functions scope. The CLI has no way to
    prompt for the value or read it from stdin.
  - nginx: the key file is written from a prompt (`read -rs`).
  - container: an environment file readable only by its owner, written from a
    prompt and passed with `docker run --env-file`.
  - Traefik: the compose service reads `site-relay.env` (`env_file`), written
    the same way. On Kubernetes the Secret is created with `--from-file` from a
    file written from a prompt and then removed.
  - Caddy: `/etc/caddy/fingerly.env` (root, mode 600), written from a prompt;
    the systemd override only names it with `EnvironmentFile=`.
  - CloudFront: the CloudFormation `FingerlyProxyKey` parameter goes in the
    console's masked field, or in a parameters file (mode 600) written from a
    prompt, passed with `--parameter-overrides file://` and removed.
- A test holds every README and dashboard step except Cloud Run's to never
  carrying the key on a command line, and runs each prompt in bash and zsh to
  check the file it writes.
- `console-snippets.json` is generated from the templates, including the
  Cloud Run `package.json` licence line.
