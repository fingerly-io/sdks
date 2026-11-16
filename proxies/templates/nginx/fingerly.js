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

/** Only a final answer in 200 to 599, outside 300 to 399, is relayed. */
function relayable(status) {
  return status >= 200 && status <= 599 && (status < 300 || status > 399)
}

// Plain ES5 loops: the default njs engine supports no `for...of`.
function relay(r) {
  // A redirect, or any status outside 200 to 599, is answered 502 with none
  // of its headers; `body` below replaces what it carried.
  var refused = !relayable(r.status)
  if (refused) {
    r.variables.fingerly_refused = '1'
    r.status = 502
  }
  var names = Object.keys(r.headersOut)
  for (var i = 0; i < names.length; i++) {
    var name = names[i].toLowerCase()
    if (refused ? name !== 'cache-control' : RELAYED.indexOf(name) === -1) delete r.headersOut[names[i]]
  }
  if (refused) r.headersOut['Content-Type'] = 'text/plain; charset=utf-8'
}

function body(r, data, flags) {
  if (r.variables.fingerly_refused !== '1') return r.sendBuffer(data, flags)
  if (flags.last) r.sendBuffer('Bad gateway', flags)
}

export default { relay, body }
