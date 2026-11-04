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
- The same four read the API's answer whole, capped at 4 MiB and under one
  5-second deadline, before relaying it: a timeout answers 504, and an
  unreachable API, a broken answer or one over the cap answers 502.
- `console-snippets.json` is regenerated from the templates, including the
  Cloud Run `package.json` licence line.
