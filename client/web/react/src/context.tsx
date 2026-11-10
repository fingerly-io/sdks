'use client'

/**
 * The context, and the provider that fills it.
 */

import { createContext, useEffect, useMemo, type ReactNode } from 'react'

import { createFingerlyStore, type FingerlyReactOptions, type FingerlyStore } from './store.js'

/**
 * The context itself.
 *
 * Exported so an advanced caller can read it with `use()` directly - and so a
 * test can provide a store without going through the component.
 */
export const FingerlyContext = createContext<FingerlyStore | null>(null)

FingerlyContext.displayName = 'Fingerly'

export type FingerlyProviderProps = { children?: ReactNode } & (
  | (FingerlyReactOptions & { store?: never })
  /**
   * A store built elsewhere.
   *
   * The case this is for is a server-rendered app that wants one store per
   * request rather than one per module - a module-level store on a Node server
   * is shared by every visitor it renders for, which is the one way this
   * package could leak one visitor's report into another's page.
   */
  | { store: FingerlyStore; apiKey?: never; apiVersion?: never; endpoints?: never; fallbackToDefaultEndpoint?: never; submit?: never; consent?: never }
)

/**
 * Make the client and the shared result available to everything below.
 *
 * ```tsx
 * <FingerlyProvider apiKey="fly_pk_production_…">
 *   <App />
 * </FingerlyProvider>
 * ```
 *
 * Nothing is collected on mount. The provider only makes identification
 * *possible*; when it happens is the page's decision, taken with
 * `useIdentify({ immediate: true })` or a call of its own.
 *
 * `consent` is read as the current answer rather than as configuration: pass
 * whatever the consent tool says now, and a change from `pending` to `granted`
 * starts any automatic identification that was waiting, on the same store.
 */
export function FingerlyProvider(props: FingerlyProviderProps): ReactNode {
  const { children, store, apiKey, apiVersion, endpoints, fallbackToDefaultEndpoint, submit, consent } = props as FingerlyProviderProps & FingerlyReactOptions

  // Keyed on the values rather than on the options object, so the ordinary
  // `<FingerlyProvider apiKey="…">` - a fresh object literal on every render of
  // the parent - does not rebuild the store and throw away the identification
  // underneath it.
  // The endpoint list by its contents, not its identity: `endpoints={['/k7x2qm4a']}`
  // is a new array on every render, as is one deserialised from a Server
  // Component's payload on each router.refresh(). Keyed on the array itself,
  // either rebuilt the store, and with it the identification, every time.
  const endpointsKey = endpoints === undefined || typeof endpoints === 'string' ? endpoints : JSON.stringify(endpoints)
  const created = useMemo(
    () =>
      createFingerlyStore({
        apiKey: apiKey as string,
        ...(apiVersion === undefined ? {} : { apiVersion }),
        ...(endpoints === undefined ? {} : { endpoints }),
        ...(fallbackToDefaultEndpoint === undefined ? {} : { fallbackToDefaultEndpoint }),
        ...(submit === undefined ? {} : { submit }),
        ...(consent === undefined ? {} : { consent }),
      }),
    // Not keyed on `consent`. A banner being accepted is the visitor answering
    // a question, not a new configuration, and rebuilding the store for it
    // would discard the identification it is about to allow. The value at
    // creation seeds the store; the effect below carries every change after.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- endpointsKey stands for endpoints
    [apiKey, apiVersion, endpointsKey, fallbackToDefaultEndpoint, submit],
  )

  useEffect(() => {
    if (!store && consent !== undefined) created.setConsent(consent)
  }, [store, created, consent])

  // React 19 renders a context directly. `<FingerlyContext.Provider>` still
  // works and means the same thing.
  return <FingerlyContext value={store ?? created}>{children}</FingerlyContext>
}
