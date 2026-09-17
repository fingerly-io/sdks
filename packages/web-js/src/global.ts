/**
 * The script-tag entry point.
 *
 * Bundled as an IIFE under the global name `Fingerly`, with `@fingerly/core` inlined
 * rather than externalised - a page dropping in one `<script>` has no module
 * resolution to do the linking.
 */

export { load, browserSources, inspectIntegrity, ConsentError, FingerlyClient, SOURCE, TransportError } from './index.js'
