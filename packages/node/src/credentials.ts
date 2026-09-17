export interface Credential {
  kind: "pk" | "sk" | "px";
  region: "eu" | "us";
  environment: string;
}
export function credential(
  key: string,
  expected: Credential["kind"],
): Credential {
  const match =
    /^fly_(pk|sk|px)_(eu|us)_(production|staging|development)_([A-Za-z0-9_-]+)$/.exec(
      key,
    );
  if (!match || match[1] !== expected)
    throw new TypeError(
      `A valid regional Fingerly ${expected === "sk" ? "secret" : expected === "pk" ? "public" : "proxy"} key is required`,
    );
  return {
    kind: expected,
    region: match[2] as Credential["region"],
    environment: match[3]!,
  };
}
export function endpointForKey(
  key: string,
  expected: Credential["kind"],
): string {
  return `https://${credential(key, expected).region}.api.fingerly.io`;
}
export function endpoint(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new TypeError(
      "endpoint must be an HTTP(S) URL without credentials, query, or fragment",
    );
  return value.replace(/\/+$/, "");
}
