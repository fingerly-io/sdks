/**
 * Builds console-snippets.json: the steps the dashboard prints for each proxy
 * kind, with the template files embedded as they ship. `/k7x2qm4a` and
 * `fly_px_production_…` are the placeholders the dashboard fills in with the
 * proxy's own path and key.
 *
 *   node scripts/console-snippets.mjs          write the file
 *   node scripts/console-snippets.mjs --check  fail when it is out of date
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const OUTPUT = `${ROOT}console-snippets.json`

const KEY = 'fly_px_production_…'
const read = (path) => readFileSync(`${ROOT}${path}`, 'utf8')

/** The Caddyfile's handle block, without the example site around it. */
function caddyHandleBlock() {
  const lines = read('caddy/Caddyfile').split('\n')
  const start = lines.findIndex((line) => line.startsWith('\thandle /k7x2qm4a {'))
  const end = lines.findIndex((line, index) => index > start && line === '\t}')
  if (start < 0 || end < 0) throw new Error('caddy/Caddyfile: handle block not found')
  return `${lines.slice(start, end + 1).map((line) => line.replace(/^\t/, '')).join('\n')}\n`
}

/** A file without its leading comment lines. */
function withoutLeadingComments(text) {
  const lines = text.split('\n')
  const first = lines.findIndex((line) => !line.startsWith('#'))
  return lines.slice(first).join('\n')
}

const browserStep = {
  title: 'Point the browser SDK at the path',
  text: 'Pass the path as the endpoint. The SDK posts to it exactly as given.',
  label: 'JavaScript',
  code: `await load({\n  apiKey: 'fly_pk_production_…',\n  endpoints: '/k7x2qm4a',\n  consent: 'granted', // only once the visitor has agreed, or you have another lawful basis\n})\n`,
}

export function build() {
  return {
    nginx: {
      steps: [
        {
          title: 'Add the proxy location',
          text: 'Save this as /etc/nginx/snippets/fingerly.conf.',
          label: '/etc/nginx/snippets/fingerly.conf',
          code: read('nginx/fingerly.conf'),
        },
        {
          title: 'Store the proxy key',
          text: 'In its own file, readable only by root. Keep it out of version control.',
          label: 'Terminal',
          code: [
            'sudo install -m 600 -o root -g root /dev/null /etc/nginx/fingerly-proxy-key.conf',
            `echo 'set $fingerly_proxy_key "${KEY}";' | sudo tee /etc/nginx/fingerly-proxy-key.conf >/dev/null`,
            '',
          ].join('\n'),
        },
        {
          title: 'Include it in your site',
          text: 'Inside the server block that serves your pages.',
          label: 'nginx.conf',
          code: 'server {\n    server_name www.example.com;\n    include /etc/nginx/snippets/fingerly.conf;\n    # ...\n}\n',
        },
        {
          title: 'Reload nginx',
          text: 'Behind a load balancer, set up the realip module first so the visitor address is right.',
          label: 'Terminal',
          code: 'sudo nginx -t && sudo systemctl reload nginx\n',
        },
        browserStep,
      ],
    },
    caddy: {
      steps: [
        {
          title: 'Add the handle block',
          text: 'First in the site block that serves your pages.',
          label: 'Caddyfile',
          code: caddyHandleBlock(),
        },
        {
          title: 'Give Caddy the proxy key',
          text: 'Run sudo systemctl edit caddy and add these lines. The key belongs in the environment of the Caddy process, never in the Caddyfile.',
          label: 'Service override',
          code: `[Service]\nEnvironment=FINGERLY_PROXY_KEY=${KEY}\n`,
        },
        {
          title: 'Restart Caddy',
          text: 'A restart, so Caddy sees the new environment. Behind a load balancer, set trusted_proxies and trusted_proxies_strict first so the visitor address is right.',
          label: 'Terminal',
          code: 'sudo systemctl restart caddy\n',
        },
        browserStep,
      ],
    },
    vercel: {
      steps: [
        {
          title: 'Add middleware.ts',
          text: 'At the root of your project, beside package.json.',
          label: 'middleware.ts',
          code: read('vercel/middleware.ts'),
        },
        {
          title: 'Add the proxy key',
          text: 'As a sensitive environment variable.',
          label: 'Terminal',
          code: `vercel env add FINGERLY_PROXY_KEY production --value "${KEY}" --sensitive --yes\n`,
        },
        {
          title: 'Deploy',
          text: 'The middleware runs on the next production deployment.',
          label: 'Terminal',
          code: 'vercel deploy --prod\n',
        },
        browserStep,
      ],
    },
    netlify: {
      steps: [
        {
          title: 'Add the edge function',
          text: 'Save this as netlify/edge-functions/relay.ts.',
          label: 'netlify/edge-functions/relay.ts',
          code: read('netlify/edge-functions/relay.ts'),
        },
        {
          title: 'Bind it to the path',
          text: 'Add this to netlify.toml at the root of your site.',
          label: 'netlify.toml',
          code: withoutLeadingComments(read('netlify/netlify.toml')),
        },
        {
          title: 'Add the proxy key',
          text: 'As an environment variable scoped to functions.',
          label: 'Terminal',
          code: `netlify env:set FINGERLY_PROXY_KEY ${KEY} --scope functions\n`,
        },
        {
          title: 'Deploy',
          text: 'The function runs on the next production deploy.',
          label: 'Terminal',
          code: 'netlify deploy --prod\n',
        },
        browserStep,
      ],
    },
    'aws-cloudfront': {
      steps: [
        {
          title: 'Create the function',
          text: 'CloudFront > Functions > Create function, runtime cloudfront-js-2.0. Paste this, save and publish.',
          label: 'function.js',
          code: read('aws-cloudfront/function.js'),
        },
        {
          title: 'Add the origin',
          text: 'In the distribution that serves your site. CloudFront always overwrites a viewer-sent header of the same name.',
          label: 'Origin',
          code: [
            'Origin domain:  api.fingerly.io',
            'Protocol:       HTTPS only',
            `Custom header:  x-fingerly-proxy-key = ${KEY}`,
            '',
          ].join('\n'),
        },
        {
          title: 'Add the cache behavior',
          text: 'Associate the function with both the viewer request and the viewer response.',
          label: 'Cache behavior',
          code: [
            'Path pattern:            /k7x2qm4a',
            'Origin:                  api.fingerly.io',
            'Viewer protocol policy:  HTTPS only',
            'Allowed HTTP methods:    GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE',
            'Cache policy:            CachingDisabled',
            'Origin request policy:   AllViewerExceptHostHeader',
            'Viewer request:          CloudFront Functions, the function above',
            'Viewer response:         CloudFront Functions, the function above',
            '',
          ].join('\n'),
        },
        browserStep,
      ],
    },
    container: {
      steps: [
        {
          title: 'Save the service',
          text: 'Save this as server.mjs in an empty folder.',
          label: 'server.mjs',
          code: read('container/server.mjs'),
        },
        {
          title: 'Save its Dockerfile',
          text: 'Beside server.mjs. The image has no dependencies and runs as an unprivileged user.',
          label: 'Dockerfile',
          code: read('container/Dockerfile'),
        },
        {
          title: 'Build and run it',
          text: 'Take the key from your secret store. remote trusts the connection address; behind a proxy use header:<name> for a header that proxy overwrites, or xff:<n> for the n-th X-Forwarded-For entry from the right.',
          label: 'Terminal',
          code: [
            'docker build -t site-relay .',
            `export FINGERLY_PROXY_KEY='${KEY}'`,
            'docker run -d --name site-relay --restart unless-stopped -p 8080:8080 \\',
            '  -e FINGERLY_PATH=/k7x2qm4a -e FINGERLY_PROXY_KEY \\',
            '  -e FINGERLY_CLIENT_IP_SOURCE=remote \\',
            '  site-relay',
            '',
          ].join('\n'),
        },
        {
          title: 'Route the path to it',
          text: 'From the proxy or load balancer in front, send exactly this path on your site\'s host to the container, POST bodies included.',
          label: 'Routing',
          code: 'POST https://www.example.com/k7x2qm4a  ->  http://site-relay:8080/k7x2qm4a\n',
        },
        browserStep,
      ],
    },
    traefik: {
      steps: [
        {
          title: 'Save the service',
          text: 'Save this as site-relay/server.mjs beside your compose file.',
          label: 'site-relay/server.mjs',
          code: read('container/server.mjs'),
        },
        {
          title: 'Save its Dockerfile',
          text: 'Beside it, as site-relay/Dockerfile.',
          label: 'site-relay/Dockerfile',
          code: read('container/Dockerfile'),
        },
        {
          title: 'Add it to your compose project',
          text: 'In the project Traefik routes with its Docker provider, on a network Traefik can reach. Add entrypoints and tls labels if your other routers have them.',
          label: 'docker-compose.yml',
          code: read('traefik/docker-compose.yml'),
        },
        {
          title: 'Start it',
          text: 'Take the key from your secret store or an .env file kept out of version control.',
          label: 'Terminal',
          code: `FINGERLY_PROXY_KEY='${KEY}' docker compose up -d --build site-relay\n`,
        },
        browserStep,
      ],
    },
    'gcp-cloud-run': {
      steps: [
        {
          title: 'Save the service',
          text: 'Save this as server.mjs in an empty folder.',
          label: 'server.mjs',
          code: read('gcp-cloud-run/server.mjs'),
        },
        {
          title: 'Save its package.json',
          text: 'Beside server.mjs. Buildpacks build the service from it; no Dockerfile is needed.',
          label: 'package.json',
          code: read('gcp-cloud-run/package.json'),
        },
        {
          title: 'Store the proxy key',
          text: 'In Secret Manager, readable by the service\'s runtime service account.',
          label: 'Terminal',
          code: [
            `printf '%s' '${KEY}' | gcloud secrets create first-party-relay-key --data-file=-`,
            'gcloud secrets add-iam-policy-binding first-party-relay-key \\',
            '  --member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com \\',
            '  --role=roles/secretmanager.secretAccessor',
            '',
          ].join('\n'),
        },
        {
          title: 'Deploy',
          text: 'From the folder. The ingress setting means only your load balancer can reach it.',
          label: 'Terminal',
          code: [
            'gcloud run deploy site-relay --source . --region=europe-west1 \\',
            '  --ingress=internal-and-cloud-load-balancing --allow-unauthenticated \\',
            '  --set-env-vars=FINGERLY_PATH=/k7x2qm4a \\',
            '  --set-secrets=FINGERLY_PROXY_KEY=first-party-relay-key:latest',
            '',
          ].join('\n'),
        },
        {
          title: 'Add it to your load balancer',
          text: 'A serverless NEG and a backend service. Use the scheme your load balancer uses: EXTERNAL_MANAGED, or EXTERNAL for the classic one.',
          label: 'Terminal',
          code: [
            'gcloud compute network-endpoint-groups create site-relay-neg \\',
            '  --region=europe-west1 --network-endpoint-type=serverless \\',
            '  --cloud-run-service=site-relay',
            'gcloud compute backend-services create site-relay-backend \\',
            '  --global --load-balancing-scheme=EXTERNAL_MANAGED',
            'gcloud compute backend-services add-backend site-relay-backend \\',
            '  --global --network-endpoint-group=site-relay-neg \\',
            '  --network-endpoint-group-region=europe-west1',
            '',
          ].join('\n'),
        },
        {
          title: 'Route the path to it',
          text: 'In the URL map that serves your site. If your host already has a path matcher, add a path rule for /k7x2qm4a to it instead (Load balancing > Edit > Routing rules).',
          label: 'Terminal',
          code: [
            'gcloud compute url-maps add-path-matcher URL_MAP --global \\',
            '  --path-matcher-name=site --default-service=YOUR_SITE_BACKEND \\',
            '  --new-hosts=www.example.com --path-rules=/k7x2qm4a=site-relay-backend',
            '',
          ].join('\n'),
        },
        browserStep,
      ],
    },
  }
}

export function render() {
  return `${JSON.stringify(build(), null, 2)}\n`
}

/**
 * The console's copy, when the panels repository sits beside this one as it
 * does in the workspace. The dashboard prints these steps, and it is a
 * separate repository, so it keeps its own copy; writing both here is what
 * stops the two drifting.
 */
const CONSOLE_COPY = fileURLToPath(new URL('../../../../panels/apps/client/app/data/proxy-templates.json', import.meta.url))
const consoleRepo = fileURLToPath(new URL('../../../../panels/apps/client/app/', import.meta.url))

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const next = render()
  const outputs = existsSync(consoleRepo) ? [OUTPUT, CONSOLE_COPY] : [OUTPUT]
  if (process.argv.includes('--check')) {
    for (const output of outputs) {
      let current = ''
      try {
        current = readFileSync(output, 'utf8')
      } catch {
        // Missing counts as out of date.
      }
      if (current !== next) {
        console.error(`${output} is out of date: run \`pnpm run snippets\`.`)
        process.exit(1)
      }
    }
  } else {
    for (const output of outputs) {
      mkdirSync(dirname(output), { recursive: true })
      writeFileSync(output, next)
    }
  }
}
