/**
 * The script-tag entry point.
 *
 * Bundled as an IIFE under the global name `Badele`, with `@badele/core` inlined
 * rather than externalised - a page dropping in one `<script>` has no module
 * resolution to do the linking.
 */

export { load, browserSources, inspectIntegrity, BadeleClient, SOURCE, TransportError } from './index.js'
