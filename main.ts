
const UPSTREAM_ORIGIN = "https://nowgg.lol";
const ROBLOX_DEFAULT_PATH = "/play/uncube/7074/now?ng_ifp_partner=skool";

const ALLOWED_METHODS = [
  "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS",
];

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
    "Access-Control-Allow-Methods": ALLOWED_METHODS.join(", "),
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Accept, Range, If-None-Match",
  });
}

function errorResponse(message: string, status: number): Response {
  return new Response(message, { status, headers: corsHeaders() });
}

function isBlocked(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  return (
    BLOCKED_HOSTS.some(
      (item) => host === item || host.endsWith("." + item),
    ) ||
    /\/(ads?|advertising|telemetry|analytics|metrics)(\/|$)/i.test(path) ||
    /prebid|adblock|amplitude|fingerprint|telemetry/i.test(path)
  );
}

function buildEmbedPage(): string {
  const gameUrl = UPSTREAM_ORIGIN + ROBLOX_DEFAULT_PATH;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Roblox</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #111;
    }
    iframe {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
    }
  </style>
</head>
<body>
  <iframe
    src="${gameUrl}"
    title="Roblox"
    allow="fullscreen; autoplay; gamepad"
    allowfullscreen
  ></iframe>
</body>
</html>`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const incoming = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (!ALLOWED_METHODS.includes(req.method)) {
    return errorResponse("Method not allowed", 405);
  }

  if (
    incoming.pathname === "/" ||
    incoming.pathname === "/index.html"
  ) {
    const headers = corsHeaders();
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Cache-Control", "no-store");

    return new Response(buildEmbedPage(), { status: 200, headers });
  }

  // Optional filtering endpoint for requests on the configured origin.
  if (incoming.pathname === "/filter-check") {
    const requested = incoming.searchParams.get("url");

    if (!requested) {
      return errorResponse("Missing url parameter", 400);
    }

    let target: URL;

    try {
      target = new URL(requested);
    } catch {
      return errorResponse("Invalid URL", 400);
    }

    if (target.protocol !== "https:") {
      return errorResponse("HTTPS required", 403);
    }

    return new Response(
      JSON.stringify({ blocked: isBlocked(target) }),
      {
        status: 200,
        headers: new Headers({
          ...Object.fromEntries(corsHeaders()),
          "Content-Type": "application/json",
        }),
      },
    );
  }

  return errorResponse("Not found", 404);
});
