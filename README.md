# badele/sdks

Client SDKs for the Badele fraud detection/prevention platform. pnpm workspace +
Turborepo.

See [`server/docs/architecture.md`](../server/docs/architecture.md) for how this
repo relates to `server` and `panels`.

## Layout

- `packages/core` — framework-agnostic device/event core (TS), shared by every SDK
- `packages/web-js` — vanilla browser SDK
- `packages/node` — server-side Node SDK
- `packages/{react,vue,svelte,angular,nuxt,next}` — framework bindings, built on
  `web-js`/`vue`/`react`
- `mobile/ios`, `mobile/android` — native SDKs, currently standalone local repos
  (see their READMEs), destined to become git submodules once remotes exist
- `mobile/react-native` — JS/TS package in the pnpm workspace (bridges native
  modules)
- `mobile/flutter` — Dart/pub package, standalone local repo, not part of the pnpm
  workspace
- `contract` — API contract synced from `server`'s OpenAPI spec; the sync point for
  the API shape across every SDK/panel consumer

## Development

```
pnpm install
pnpm build
```
