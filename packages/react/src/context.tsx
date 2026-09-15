'use client'

/**
 * The context, and the provider that fills it.
 */

import { createContext, useMemo, type ReactNode } from 'react'

import { createBadeleStore, type BadeleReactOptions, type BadeleStore } from './store.js'

/**
 * The context itself.
 *
 * Exported so an advanced caller can read it with `use()` directly - and so a
 * test can provide a store without going through the component.
 */
export const BadeleContext = createContext<BadeleStore | null>(null)

BadeleContext.displayName = 'Badele'

export type BadeleProviderProps = { children?: ReactNode } & (
  | (BadeleReactOptions & { store?: never })
  /**
   * A store built elsewhere.
   *
   * The case this is for is a server-rendered app that wants one store per
   * request rather than one per module - a module-level store on a Node server
   * is shared by every visitor it renders for, which is the one way this
   * package could leak one visitor's report into another's page.
   */
  | { store: BadeleStore; apiKey?: never; endpoint?: never; endpoints?: never; fallbackToDefaultEndpoint?: never; submit?: never }
)

/**
 * Make the client and the shared result available to everything below.
 *
 * ```tsx
 * <BadeleProvider apiKey="pk_live_…">
 *   <App />
 * </BadeleProvider>
 * ```
 *
 * Nothing is collected on mount. The provider only makes identification
 * *possible*; when it happens is the page's decision, taken with
 * `useIdentify({ immediate: true })` or a call of its own.
 */
export function BadeleProvider(props: BadeleProviderProps): ReactNode {
  const { children, store, apiKey, endpoint, endpoints, fallbackToDefaultEndpoint, submit } = props as BadeleProviderProps & BadeleReactOptions

  // Keyed on the values rather than on the options object, so the ordinary
  // `<BadeleProvider apiKey="…">` - a fresh object literal on every render of
  // the parent - does not rebuild the store and throw away the identification
  // underneath it.
  const created = useMemo(
    () =>
      createBadeleStore({
        apiKey: apiKey as string,
        ...(endpoint === undefined ? {} : { endpoint }),
        ...(endpoints === undefined ? {} : { endpoints }),
        ...(fallbackToDefaultEndpoint === undefined ? {} : { fallbackToDefaultEndpoint }),
        ...(submit === undefined ? {} : { submit }),
      }),
    [apiKey, endpoint, endpoints, fallbackToDefaultEndpoint, submit],
  )

  // React 19 renders a context directly. `<BadeleContext.Provider>` still
  // works and means the same thing.
  return <BadeleContext value={store ?? created}>{children}</BadeleContext>
}
