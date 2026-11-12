# Changelog

## 0.2.1

- Uses @fingerly/node 0.2.0. 0.2.0 was packed against @fingerly/node 0.1.4, because the node release had not been added to the workspace yet; use 0.2.1.

## 0.2.0

- Uses @fingerly/react 0.2.0 and @fingerly/node 0.2.0, which keeps the browser SDK from collecting inside an app's web view.

## 0.1.3

- The `endpoint` prop and `NEXT_PUBLIC_FINGERLY_ENDPOINT` are gone; use `endpoints` or `NEXT_PUBLIC_FINGERLY_ENDPOINTS`. There is no `reason` state.
- Uses @fingerly/react 0.1.2.

## 0.1.2

- Depends on `@fingerly/node` 0.1.2, which stops Next.js freezing event reads at build time.

## 0.1.1

- From `@fingerly/react` 0.1.1: `isSuspicious` comes from the server's `suspectLevel` and is `null` when the level is absent; `useVerdict()`, `verdicts` and `triggers` are removed. Read signals on your backend.
- `NEXT_PUBLIC_FINGERLY_ENDPOINTS` is parsed once per value; a malformed value is reported and ignored instead of thrown from render.
- A missing key is reported once on the console instead of thrown from render, so the page keeps rendering.
- The README's proxy route is a complete file that builds the proxy on first use and reads the visitor address from the last `X-Forwarded-For` entry.
- `reason` is deprecated and always `null`, from @fingerly/react 0.1.1: a browser is no longer told why a check went unscored.
- Uses @fingerly/react 0.1.1, with its fixes.

## 0.1.0

- First public release.
