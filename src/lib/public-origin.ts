/** Trusted deployment origin is configured by the operator; forwarded headers are never trusted. */
export function requestOrigin(
  request: Request,
  configured = process.env.APP_PUBLIC_ORIGIN,
): string {
  if (configured) {
    const origin = new URL(configured);
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      throw new Error("APP_PUBLIC_ORIGIN must be an HTTPS origin");
    if (request.headers.get("host") !== origin.host) throw new Error("Unexpected request host");
    return origin.origin;
  }
  const url = new URL(request.url);
  return `${url.protocol}//${request.headers.get("host") ?? url.host}`;
}
