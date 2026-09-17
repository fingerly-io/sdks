/** API version is configuration; resource paths do not choose it themselves. */
export function apiPrefix(version: string = 'v1'): string {
  if (!/^v[1-9]\d*$/.test(version) || version.trim() !== version)
    throw new TypeError('apiVersion must be a version such as "v1" or "v2"')
  return `/api/${version}`
}
