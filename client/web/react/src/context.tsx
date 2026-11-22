'use client'

/**
 * The context, and the provider that fills it.
 */

import { createContext, useEffect, useMemo, type ReactNode } from 'react'

import { createFingerlyStore, type FingerlyReactOptions, type FingerlyStore } from './store.js'

export const FingerlyContext = createContext<FingerlyStore | null>(null)

FingerlyContext.displayName = 'Fingerly'

export type FingerlyProviderProps = { children?: ReactNode } & (
  | (FingerlyReactOptions & { store?: never })
  | {
      store: FingerlyStore
      apiKey?: never
      apiVersion?: never
      endpoints?: never
      fallbackToDefaultEndpoint?: never
      incognitoDetection?: never
      continuity?: never
      agentDetection?: never
      consent?: never
    }
)

export function FingerlyProvider(props: FingerlyProviderProps): ReactNode {
  const {
    children,
    store,
    apiKey,
    apiVersion,
    endpoints,
    fallbackToDefaultEndpoint,
    incognitoDetection,
    continuity,
    agentDetection,
    consent,
  } = props as FingerlyProviderProps & FingerlyReactOptions

  const endpointsKey =
    endpoints === undefined || typeof endpoints === 'string' ? endpoints : JSON.stringify(endpoints)
  const created = useMemo(
    () =>
      createFingerlyStore({
        apiKey: apiKey as string,
        ...(apiVersion === undefined ? {} : { apiVersion }),
        ...(endpoints === undefined ? {} : { endpoints }),
        ...(fallbackToDefaultEndpoint === undefined ? {} : { fallbackToDefaultEndpoint }),
        ...(incognitoDetection === undefined ? {} : { incognitoDetection }),
        ...(continuity === undefined ? {} : { continuity }),
        ...(agentDetection === undefined ? {} : { agentDetection }),
        ...(consent === undefined ? {} : { consent }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- endpointsKey stands for endpoints
    [
      apiKey,
      apiVersion,
      endpointsKey,
      fallbackToDefaultEndpoint,
      incognitoDetection,
      continuity,
      agentDetection,
    ],
  )

  useEffect(() => {
    if (!store && consent !== undefined) created.setConsent(consent)
  }, [store, created, consent])

  return <FingerlyContext value={store ?? created}>{children}</FingerlyContext>
}
