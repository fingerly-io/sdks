// Fingerly first-party proxy for nginx, version 1.0.0: the response header
// allowlist, run by the njs module as a header filter of the proxy location.
//
// Core nginx can only hide named upstream headers. A blocker can match a
// response header by name, so an allowlist is what guarantees nothing on the
// way back names Fingerly, whatever the API sends in future. nginx adds its
// own Date, Server and framing headers after this filter runs.

/** The response headers relayed to the caller, plus the pinned Cache-Control and framing. */
var RELAYED = [
  'content-type',
  'x-request-id',
  'ratelimit-limit',
  'ratelimit-remaining',
  'retry-after',
  'cache-control',
  'allow',
  'content-length',
  'content-encoding',
  'transfer-encoding',
]

// Plain ES5 loops: the default njs engine supports no `for...of`.
function relay(r) {
  var names = Object.keys(r.headersOut)
  for (var i = 0; i < names.length; i++) {
    if (RELAYED.indexOf(names[i].toLowerCase()) === -1) delete r.headersOut[names[i]]
  }
}

export default { relay }
