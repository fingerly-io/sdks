/**
 * The version reported in every submission's `sdk.version`.
 *
 * A literal rather than a read of `package.json`, because this package builds
 * for a browser bundle where there is no `package.json` to read, and an SDK
 * that reports the wrong version makes "this only happens on 0.2.1"
 * unanswerable - which is the one question this field exists to answer.
 */
export const SDK_VERSION = '0.1.0'
