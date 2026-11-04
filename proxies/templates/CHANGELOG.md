# Changelog

## 1.0.0 (unreleased)

- Every template answers exactly the issued path: no trailing slash, nothing
  under it, case-sensitive.
- The container, Cloud Run, nginx and Caddy templates compare the raw request
  target, so a doubled slash, a dot segment or a percent-encoded character
  that would clean up to the issued path is no longer forwarded. Caddy's path
  match is no longer case-insensitive.
- The Vercel, Netlify, container, Cloud Run and CloudFront templates forward
  nothing and answer 500 ("The client IP callback returned no valid address")
  when the client IP source holds no valid address, logging it once.
- The Vercel template reads only `x-real-ip`, which Vercel sets itself. It no
  longer falls back to the left-most `x-forwarded-for` entry, which a visitor
  can write.
- The Vercel README and the dashboard snippet add the key the same way: `vercel
  env add FINGERLY_PROXY_KEY production --sensitive`, which prompts for it.
- The Netlify README and the dashboard snippet add the key in the Netlify UI,
  with the Functions scope, instead of `netlify env:set FINGERLY_PROXY_KEY
  <key>`, which put the key in the shell history. The CLI has no way to prompt
  for the value or read it from stdin.
- The nginx README and the dashboard snippet write the key file from a
  prompt (`read -rs`) instead of `echo '...key...' | sudo tee`, which put the
  key in the shell history.
- The container README and the dashboard snippet write the key to an
  environment file readable only by its owner, from a prompt, and pass it with
  `docker run --env-file`, instead of `export FINGERLY_PROXY_KEY=<key>`.
- The Traefik compose service reads the key from `site-relay.env` (`env_file`),
  written the same way, instead of `FINGERLY_PROXY_KEY=<key> docker compose
  up`. On Kubernetes the Secret is created with `--from-file` from a file
  written from a prompt and then removed, instead of `--from-literal`.
- The Caddy README and the dashboard snippet write the key to
  `/etc/caddy/fingerly.env` (root, mode 600) from a prompt, and the systemd
  override only names it with `EnvironmentFile=`. The override used to hold
  the key in an `Environment=` line, which every local user can read.
- A test holds every README and dashboard step except Cloud Run's (out of
  scope for now) to never carrying the key on a command line, and runs each
  prompt in bash and zsh to check the file it writes.
- The Vercel, Netlify, container and Cloud Run templates read the API's answer
  whole, capped at 4 MiB and under one 5-second deadline, before relaying it:
  a timeout answers 504, and an unreachable API, a broken answer or one over
  the cap answers 502.
- `console-snippets.json` is regenerated from the templates, including the
  Cloud Run `package.json` licence line.
