// Fingerly first-party proxy as a CloudFront Function, version 1.0.0.
// Runtime: cloudfront-js-2.0. Associate it with BOTH the viewer request and the
// viewer response event of the cache behavior for the path the Fingerly
// dashboard issued (`/k7x2qm4a` below; the path pattern and PATH must both hold
// it). That behavior's origin is api.fingerly.io over HTTPS, and the origin's
// custom header x-fingerly-proxy-key carries the proxy key, so the key never
// appears in this code.

// The path the dashboard issued. Keep it equal to the cache behavior's path pattern.
var PATH = '/k7x2qm4a';
var VERSION = '1.0.0';
// Where the origin (api.fingerly.io) receives both of the browser SDK's calls;
// the API tells them apart by their bodies.
var UPSTREAM_URI = '/api/v1/ingest';

// The response headers relayed to the page. A blocker can match a response
// header by name, so an allowlist is what guarantees nothing on the way back
// names Fingerly, whatever the API sends in future.
var RELAYED_HEADERS = {
  'content-type': true,
  'x-request-id': true,
  'ratelimit-limit': true,
  'ratelimit-remaining': true,
  'retry-after': true
};
// Framing headers CloudFront manages, left alone; `via` and `warning` are
// read-only in viewer response events.
var TRANSPORT_HEADERS = {
  'content-length': true,
  'content-encoding': true,
  'transfer-encoding': true,
  'date': true,
  'via': true,
  'warning': true
};

// One IPv4 or IPv6 literal and nothing else.
var IPV4 = /^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$/;
var IPV6 = /^[0-9A-Fa-f:.]{2,45}$/;

function isIpLiteral(value) {
  return typeof value === 'string' && (IPV4.test(value) || (IPV6.test(value) && value.indexOf(':') !== -1));
}

function plain(statusCode, statusDescription, extra) {
  var headers = { 'cache-control': { value: 'no-store' } };
  for (var name in extra) headers[name] = extra[name];
  return { statusCode: statusCode, statusDescription: statusDescription, headers: headers };
}

function relayResponse(response) {
  var headers = response.headers;
  for (var name in headers) {
    if (!RELAYED_HEADERS[name] && !TRANSPORT_HEADERS[name]) delete headers[name];
  }
  for (var cookie in response.cookies) delete response.cookies[cookie];
  headers['cache-control'] = { value: 'no-store' };
  return response;
}

async function handler(event) {
  if (event.context.eventType === 'viewer-response') return relayResponse(event.response);

  var request = event.request;
  // Exactly: no trailing slash, nothing under it, case-sensitive.
  if (request.uri !== PATH) return plain(404, 'Not Found', {});
  if (request.method !== 'POST') return plain(405, 'Method Not Allowed', { 'allow': { value: 'POST' } });

  var headers = request.headers;
  // Forged x-fingerly-* headers go; the origin custom header adds the proxy
  // key back after this function runs.
  for (var name in headers) {
    if (name.indexOf('x-fingerly-') === 0 || name === 'authorization') delete headers[name];
  }
  for (var cookie in request.cookies) delete request.cookies[cookie];

  // The address CloudFront accepted the connection from, not a header.
  // CloudFront always sets it; anything else forwards nothing.
  if (!isIpLiteral(event.viewer.ip)) {
    return plain(500, 'The client IP callback returned no valid address', {});
  }
  headers['x-fingerly-client-ip'] = { value: event.viewer.ip };
  headers['x-fingerly-origin'] = { value: headers.origin ? headers.origin.value : 'https://' + headers.host.value };
  if (headers['user-agent']) headers['x-fingerly-user-agent'] = { value: headers['user-agent'].value };
  headers['x-fingerly-proxy-version'] = { value: 'aws-cloudfront/' + VERSION };

  request.uri = UPSTREAM_URI;
  request.querystring = {};
  return request;
}
