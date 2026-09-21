/**
 * Wiring the SDK into an application's injector.
 *
 * Tokens and a `provide…` function rather than an `@Injectable` service, and
 * the reason is what this package can then be: no decorators anywhere means no
 * Angular compilation step, so it builds with `tsc` like every other package
 * here and drops into an app that compiles it the same way it compiles any
 * other dependency.
 */

import { inject, InjectionToken, makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core'

import { createFingerly, type Fingerly, type FingerlyOptions } from './state.js'

/**
 * The configuration, as its own token.
 *
 * Separate from the state so an app can replace one without the other - the
 * case being a test that wants the real state with a different key, or an app
 * that resolves its key from its own config service.
 */
export const FINGERLY_OPTIONS = new InjectionToken<FingerlyOptions>('fingerly.options')

/** The shared state. Reach it with [[injectFingerly]], or `inject(FINGERLY)`. */
export const FINGERLY = new InjectionToken<Fingerly>('fingerly')

/**
 * Provide the SDK to the application.
 *
 * ```ts
 * // app.config.ts
 * export const appConfig: ApplicationConfig = {
 *   providers: [provideFingerly({ apiKey: 'fly_pk_production_…' })],
 * }
 * ```
 *
 * Environment providers, so it belongs in `bootstrapApplication` or a route's
 * providers and cannot be dropped into a component's - which matters here:
 * providing it per component would give each one its own identification, and
 * the one-submission-per-page rule would quietly stop holding.
 *
 * Nothing is collected by providing it. The state is built the first time
 * something injects it, and it collects only when asked.
 */
export function provideFingerly(options: FingerlyOptions): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: FINGERLY_OPTIONS, useValue: options },
    { provide: FINGERLY, useFactory: () => createFingerly(inject(FINGERLY_OPTIONS)) },
  ])
}
