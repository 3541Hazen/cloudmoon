// Upstream pool prioritized with nowgg.lol and active bypass mirrors
const UPSTREAM_POOL = [
  "https://nowgg.lol",
  "https://nowgg.fun",
  "https://now.gg"
];

const ROBLOX_DEFAULT_PATH = "/play/uncube/7074/now?ng_ifp_partner=skool";

const BLOCKED_HOSTS = [
  "googlesyndication", "doubleclick", "googleadservices", "google-analytics",
  "googletagmanager", "googletagservices", "adservice.google", "adnxs",
  "advertising.com", "outbrain", "taboola", "criteo", "pubmatic", "openx",
  "amazon-adsystem", "popads", "popcash", "adcolony", "unityads", "ironsrc",
  "applovin", "vungle", "adroll", "quantserve", "scorecardresearch"
];

function corsHeaders(): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Range, If-None-Match",
  });
}

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "nowgg.lol" || host === "nowgg.fun" || host === "now.gg" || host.endsWith(".now.gg");
}

function isBlocked(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  return (
    BLOCKED_HOSTS.some((item) => host.includes(item)) ||
    /\/(ads?|advertising|telemetry|analytics|metrics|vpn-detect|fraud|recaptcha|hcaptcha)(\/|\$)/i.test(path) ||
    /prebid|adblock|amplitude|fingerprint|telemetry|challenge-platform/i.test(path)
  );
}

function proxyPath(url: URL): string {
  return `/proxy/${encodeURIComponent(url.href)}`;
}

// Scans HTML content for anti-proxy block text scripts
async function isDetectionScreen(response: Response): Promise<{ detected: boolean; bodyText?: string }> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return { detected: false };
  }

  const clone = response.clone();
  try {
    const text = await clone.text();
    const lowText = text.toLowerCase();

    const matchesPattern = 
      lowText.includes("vpn or proxy") || 
      lowText.includes("vpn/proxy") ||
      lowText.includes("unusual traffic") || 
      lowText.includes("checking your browser") || 
      lowText.includes("enable javascript") ||
      lowText.includes("cloudflare") ||
      lowText.includes("ddos protection") ||
      /captcha|challenge|security check|blocked/i.test(lowText);

    return { detected: matchesPattern, bodyText: text };
  } catch {
    return { detected: false };
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const incoming = new URL(req.url);
  const headers = corsHeaders();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return new Response("Method not allowed", { status: 405, headers });
  }

  for (let i = 0; i < UPSTREAM_POOL.length; i++) {
    const currentUpstream = UPSTREAM_POOL[i];
    let target: URL;

    try {
      if (incoming.pathname.startsWith("/proxy/")) {
        const encoded = incoming.pathname.slice("/proxy/".length);
        target = new URL(decodeURIComponent(encoded));
        if (incoming.search) {
          target.search = incoming.search;
        }
      } else {
        let path = incoming.pathname;
        if (path === "/" || path === "/index.html") {
          // Point dynamically to nowgg.lol uncube partner layout
          return Response.redirect(currentUpstream + ROBLOX_DEFAULT_PATH, 302);
        }
        target = new URL(path + incoming.search, currentUpstream);
      }
    } catch {
      return new Response("Bad URL", { status: 400, headers });
    }

    if (target.protocol !== "https:" || !isAllowedHost(target.hostname)) {
      return new Response("Forbidden upstream origin", { status: 403, headers });
    }

    if (isBlocked(target)) {
      return new Response(null, { status: 204, headers });
    }

    const requestHeaders = new Headers();
    for (const name of ["accept", "accept-language", "cache-control", "content-type", "range", "if-none-match", "if-modified-since"]) {
      const value = req.headers.get(name);
      if (value !== null) requestHeaders.set(name, value);
    }

    requestHeaders.set("referer", currentUpstream + "/");
    requestHeaders.set("origin", currentUpstream);
    requestHeaders.set("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");

    requestHeaders.delete("x-forwarded-for");
    requestHeaders.delete("x-real-ip");
    requestHeaders.delete("forwarded");
    requestHeaders.delete("cf-connecting-ip");

    try {
      let requestBody: ReadableStream<Uint8Array> | null = null;
      if (!["GET", "HEAD"].includes(req.method) && req.body) {
        const [tee1, tee2] = req.body.tee();
        requestBody = tee1;
        Object.defineProperty(req, "body", { value: tee2, configurable: true });
      }

      const upstreamResponse = await fetch(target, {
        method: req.method,
        headers: requestHeaders,
        body: requestBody,
        redirect: "manual",
      });

      const check = await isDetectionScreen(upstreamResponse);
      const badStatuses = [403, 429, 503];
      const isBadStatus = badStatuses.includes(upstreamResponse.status);

      if (isBadStatus || check.detected) {
        console.warn(`[Block Detected] Host ${currentUpstream} flagged deployment IP. Rotating upstream node...`);
        continue; 
      }

      const location = upstreamResponse.headers.get("location");
      if (location && upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
        const destination = new URL(location, target);
        if (!isAllowedHost(destination.hostname)) {
          return new Response("Blocked external redirect", { status: 502, headers });
        }
        headers.set("Location", proxyPath(destination));
        return new Response(null, { status: upstreamResponse.status, headers });
      }

      for (const name of ["content-type", "cache-control", "etag", "last-modified", "content-range", "accept-ranges", "content-disposition"]) {
        const value = upstreamResponse.headers.get(name);
        if (value !== null) headers.set(name, value);
      }

      return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers });

    } catch (error) {
      console.error(`Upstream connection failed for ${currentUpstream}:`, error);
      if (i === UPSTREAM_POOL.length - 1) {
        return new Response("All upstream domains blocked or unreachable", { status: 502, headers });
      }
    }
  }

  return new Response("Service unavailable due to complete upstream firewall block", { status: 503, headers });
});
