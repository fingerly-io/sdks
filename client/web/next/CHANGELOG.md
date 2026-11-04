# Changelog

## 0.1.1

- `NEXT_PUBLIC_FINGERLY_ENDPOINTS` is parsed once per value; a malformed value is reported and ignored instead of thrown from render.
- A missing key is reported once on the console instead of thrown from render, so the page keeps rendering.
- The README's proxy route is a complete file that builds the proxy on first use and reads the visitor address from the last `X-Forwarded-For` entry.
- `isSuspicious` no longer counts the `shields` verdict, from @fingerly/react 0.1.1: a privacy browser alone never makes a session look suspicious.
- Uses @fingerly/react 0.1.1, with its fixes.

## 0.1.0

- First public release.
