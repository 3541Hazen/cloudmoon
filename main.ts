const UPSTREAM = "https://now.gg";
const ROBLOX_DEFAULT_PATH = "/apps/roblox-corporation/2349/roblox.html";

// Combined blocklist for tracking network nodes and ad networks
const BLOCKED_HOSTS = [
  "googlesyndication", "doubleclick", "googleadservices", "google-analytics",
  "googletagmanager", "googletagservices", "adservice.google", "adnxs",
  "advertising.com", "outbrain", "taboola", "criteo", "pubmatic", "openx",
  "amazon-adsystem", "popads", "popcash", "adcolony", "unityads", "ironsrc",
  "applovin", "vungle", "adroll", "quantserve", "scorecardresearch", "hcaptcha", "recaptcha"
];

function isBlocked(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  return (
    BLOCKED_HOSTS.some((item) => host.includes(item)) ||
    /\/(ads?|advertising|telemetry|analytics|metrics|vpn-detect|fraud)(\/|\$)/i.test(path) ||
    /prebid|adblock|amplitude|fingerprint|telemetry/i.test(path)
  );
}

function corsHeaders(): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Range, If-None-Match, Token, X-Auth-Token, X-Requested-With",
  });
}

// STEALTH ENGINE: Overrides browser fingerprints and spoofs standard home user environment details
const STEALTH_BYPASS_SCRIPT = `
<script>
(function() {
  // Neutralize iframe tracking blocks
  Object.defineProperty(window, 'top', { get: function() { return window; } });
  Object.defineProperty(window, 'parent', { get: function() { return window; } });

  // Hide common automated driver variables (Puppeteer, Selenium, etc.)
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  
  // Spoof consistent plugins layout array to match normal home browsers
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });

  // Mock advertising tracking pipelines to make anti-adblock loops report active success
  const blankNoop = function() { return { init: function(){}, track: function(){}, send: function(){} }; };
  window.ga = blankNoop;
  window.gtag = blankNoop;
  window.amplitude = { getInstance: blankNoop };
  window.googletag = window.googletag || { cmd: [] };
  window.googletag.cmd.push = function(fn) { try { fn(); } catch(e){} return 1; };
  window.BlockAdBlock = blankNoop;
  window.Sniffer = { adsBlocked: false };

  // Intercept and bypass common third-party fingerprinting objects
  if (window.FingerprintJS || window.Fingerprint) {
    window.FingerprintJS = { load: async () => ({ get: async () => ({ visitorId: "stealth_visitor_id" }) }) };
  }

  // Auto-clean visual ad artifacts
  setInterval(() => {
    document.querySelectorAll('[id*="ad" i], [class*="ad-" i], [class*="ad_" i], [id*="google" i], iframe[src*="google"]').forEach(el => {
      if (!el.src || !el.src.includes('now.gg')) { el.remove(); }
    });
  }, 250);

  // Secure media autoplay functionality
  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function() {
    return originalPlay.apply(this, arguments).catch(() => {});
  };
})();
</script>
`;

Deno.serve(async (req: Request): Promise<Response> => {
  const incoming = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  let target: URL;
  try {
    if (incoming.pathname.startsWith("/proxy/")) {
      const encoded = incoming.pathname.slice("/proxy/".length);
      const decoded = decodeURIComponent(encoded);
      target = new URL(decoded);
      target.search = incoming.search;
    } else {
      // FORCE ROBLOX LAUNCH ON BASE ENTRY:
      // Overwrites root requests ("/") to jump directly to the target Roblox container 
      let currentPath = incoming.pathname;
      if (currentPath === "/" || currentPath === "/index.html") {
        currentPath = ROBLOX_DEFAULT_PATH;
      }
      target = new URL(currentPath + incoming.search, UPSTREAM);
    }
  } catch (_error) {
    return new Response("Bad URL", { status: 400, headers: corsHeaders() });
  }

  const allowedOrigin = new URL(UPSTREAM).origin;
  if (target.origin !== allowedOrigin && !target.hostname.includes("now.gg")) {
    return new Response("Forbidden upstream origin", { status: 403, headers: corsHeaders() });
  }

  if (isBlocked(target)) {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // --- STEALTH HEADER CLEANUP AND FORGERY ---
  const requestHeaders = new Headers();
  
  // Whitelist only safe, non-identifying standard browser headers
  const allowedHeaders = [
    "accept", "accept-language", "cache-control", "content-type", 
    "cookie", "range", "if-none-match", "if-modified-since"
  ];
  
  for (const name of allowedHeaders) {
    const value = req.headers.get(name);
    if (value !== null) { requestHeaders.set(name, value); }
  }

  // Hardcode a highly authentic residential browser user agent string
  requestHeaders.set("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
  requestHeaders.set("referer", "https://now.gg");
  requestHeaders.set("origin", "https://now.gg");

  // STAGE 2 STEALTH: Force-delete corporate proxy metadata signatures added by cloud platforms
  requestHeaders.delete("x-forwarded-for");
  requestHeaders.delete("x-forwarded-proto");
  requestHeaders.delete("x-forwarded-host");
  requestHeaders.delete("via");
  requestHeaders.delete("forwarded");
  requestHeaders.delete("true-client-ip");
  requestHeaders.delete("cf-connecting-ip");
  requestHeaders.delete("x-real-ip");

  try {
    const upstreamResponse = await fetch(target, {
      method: req.method,
      headers: requestHeaders,
      body: ["GET", "HEAD"].includes(req.method) ? null : req.body,
      redirect: "manual",
    });

    if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
      const location = upstreamResponse.headers.get("location");
      if (location) {
        const destination = new URL(location, target);
        return new Response(null, {
          status: upstreamResponse.status,
          headers: {
            ...Object.fromEntries(corsHeaders()),
            "Location": destination.pathname + destination.search + destination.hash,
          },
        });
      }
    }

    const responseHeaders = corsHeaders();
    for (const name of ["content-type", "cache-control", "etag", "last-modified", "content-range", "accept-ranges", "content-disposition"]) {
      const value = upstreamResponse.headers.get(name);
      if (value !== null) { responseHeaders.set(name, value); }
    }

    const contentType = upstreamResponse.headers.get("content-type") || "";

    // DOM PATCHING & INJECTION LOOP
    if (contentType.includes("text/html")) {
      let text = await upstreamResponse.text();
      
      text = text.replace(/href="\/([^/\s][^"]*)"/g, 'href="/\$1"');
      text = text.replace(/src="\/([^/\s][^"]*)"/g, 'src="/\$1"');

      // Intercept and strip scripts targeting security validation structures
      text = text.replace(/<script[^>]*src="[^"]*(googlesyndication|google-analytics|amplitude|amazon-adsystem|fingerprint)[^"]*"[^>]*><\/script>/gi, "<!-- Stripped Shield Tracking -->");

      if (text.includes("<head>")) {
        text = text.replace("<head>", `<head>${STEALTH_BYPASS_SCRIPT}`);
      } else {
        text = STEALTH_BYPASS_SCRIPT + text;
      }

      return new Response(text, { status: upstreamResponse.status, headers: responseHeaders });
    }

    return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers: responseHeaders });
  } catch (error) {
    console.error("now.gg connection failure under proxy shield:", error);
    return new Response("Upstream request failed", { status: 502, headers: corsHeaders() });
  }
});
