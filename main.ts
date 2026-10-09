
const UPSTREAM = "https://now.gg";
const ROBLOX_DEFAULT_PATH =
  "/apps/roblox-corporation/2349/roblox.html";

const BLOCKED_HOSTS = [
  "googlesyndication",
  "doubleclick",
  "googleadservices",
  "google-analytics",
  "googletagmanager",
  "googletagservices",
  "adservice.google",
  "adnxs",
  "advertising.com",
  "outbrain",
  "taboola",
  "criteo",
  "pubmatic",
  "openx",
  "amazon-adsystem",
  "popads",
  "popcash",
  "adcolony",
  "unityads",
  "ironsrc",
  "applovin",
  "vungle",
  "adroll",
  "quantserve",
  "scorecardresearch",
];

function corsHeaders(): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":
      "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Accept, Range, If-None-Match",
  });
}

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "now.gg" || host.endsWith(".now.gg");
}

function isBlocked(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  return (
    BLOCKED_HOSTS.some((item) => host.includes(item)) ||
    /\/(ads?|advertising|telemetry|analytics|metrics|vpn-detect|fraud)(\/|$)/i.test(
      path,
    ) ||
    /prebid|adblock|amplitude|fingerprint|telemetry/i.test(path)
  );
}

function proxyPath(url: URL): string {
  return `/proxy/${encodeURIComponent(url.href)}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const incoming = new URL(req.url);
  const headers = corsHeaders();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return new Response("Method not allowed", {
      status: 405,
      headers,
    });
  }

  let target: URL;

  try {
    if (incoming.pathname.startsWith("/proxy/")) {
      const encoded = incoming.pathname.slice("/proxy/".length);
      target = new URL(decodeURIComponent(encoded));

      // Preserve the query supplied to the proxy, if present.
      if (incoming.search) {
        target.search = incoming.search;
      }
    } else {
      let path = incoming.pathname;

      if (path === "/" || path === "/index.html") {
        path = ROBLOX_DEFAULT_PATH;
      }

      target = new URL(path + incoming.search, UPSTREAM);
    }
  } catch {
    return new Response("Bad URL", {
      status: 400,
      headers,
    });
  }

  if (target.protocol !== "https:" || !isAllowedHost(target.hostname)) {
    return new Response("Forbidden upstream origin", {
      status: 403,
      headers,
    });
  }

  if (isBlocked(target)) {
    return new Response(null, {
      status: 204,
      headers,
    });
  }

  const requestHeaders = new Headers();

  for (const name of [
    "accept",
    "accept-language",
    "cache-control",
    "content-type",
    "range",
    "if-none-match",
    "if-modified-since",
  ]) {
    const value = req.headers.get(name);
    if (value !== null) {
      requestHeaders.set(name, value);
    }
  }

  requestHeaders.set("referer", UPSTREAM + "/");

  try {
    const upstreamResponse = await fetch(target, {
      method: req.method,
      headers: requestHeaders,
      body: ["GET", "HEAD"].includes(req.method)
        ? null
        : req.body,
      redirect: "manual",
    });

    const location = upstreamResponse.headers.get("location");

    if (
      location &&
      upstreamResponse.status >= 300 &&
      upstreamResponse.status < 400
    ) {
      const destination = new URL(location, target);

      if (
        destination.protocol !== "https:" ||
        !isAllowedHost(destination.hostname)
      ) {
        return new Response("Blocked external redirect", {
          status: 502,
          headers,
        });
      }

      headers.set("Location", proxyPath(destination));

      return new Response(null, {
        status: upstreamResponse.status,
        headers,
      });
    }

    for (const name of [
      "content-type",
      "cache-control",
      "etag",
      "last-modified",
      "content-range",
      "accept-ranges",
      "content-disposition",
    ]) {
      const value = upstreamResponse.headers.get(name);
      if (value !== null) {
        headers.set(name, value);
      }
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers,
    });
  } catch (error) {
    console.error("Upstream request failed:", error);

    return new Response("Upstream request failed", {
      status: 502,
      headers,
    });
  }
});
