// Use standard ESM imports with the node: compatibility prefix
import http from "node:http";
import https from "node:https";

// Configuration
const PORT = 8080;
const UPSTREAM = "https://nowgg.lol";
const ROBLOX_DEFAULT_PATH = "/apps/roblox-corporation/2349/roblox.html";

function getCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

function resolveTarget(incoming: URL): URL {
  if (incoming.pathname.startsWith("/proxy/")) {
    const encoded = incoming.pathname.slice("/proxy/".length);
    const target = new URL(decodeURIComponent(encoded));

    if (target.protocol !== "https:") {
      throw new Error("Only HTTPS upstream URLs are allowed");
    }

    if (target.hostname !== "nowgg.lol" && !target.hostname.endsWith(".nowgg.lol")) {
      throw new Error("Forbidden upstream host");
    }

    if (incoming.search) {
      target.search = incoming.search;
    }
    return target;
  }

  const path = (incoming.pathname === "/" || incoming.pathname === "/index.html")
    ? ROBLOX_DEFAULT_PATH
    : incoming.pathname;

  return new URL(path + incoming.search, UPSTREAM);
}

// Serves the full-screen iframe template with a loading overlay for the root layout
function getHtmlTemplate(targetUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NowGG Proxy Base</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0; width: 100%; height: 100%;
      background-color: #0f0f12; font-family: sans-serif; overflow: hidden;
    }
    #loading-screen {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background-color: #121214; display: flex; flex-direction: column;
      align-items: center; justify-content: center; z-index: 9999;
      transition: opacity 0.5s ease, transform 0.5s ease; color: #fff;
    }
    .spinner {
      width: 50px; height: 50px; border: 5px solid #27272a;
      border-top: 5px solid #6366f1; border-radius: 50%;
      animation: spin 1s linear infinite; margin-bottom: 20px;
    }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    iframe {
      width: 100%; height: 100%; border: none; display: block;
      background-color: transparent;
    }
    .fade-out { opacity: 0; pointer-events: none; transform: scale(1.05); }
  </style>
</head>
<body>
  <div id="loading-screen">
    <div class="spinner"></div>
    <div style="font-weight: 600; letter-spacing: 0.5px;">Loading Upstream Client...</div>
  </div>
  <iframe id="game-frame" src="${targetUrl}"></iframe>
  <script>
    const frame = document.getElementById('game-frame');
    const loader = document.getElementById('loading-screen');
    frame.addEventListener('load', () => {
      loader.classList.add('fade-out');
      setTimeout(() => loader.remove(), 500);
    });
  </script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, getCorsHeaders());
    res.end();
    return;
  }

  let target: URL;
  try {
    const incomingUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    
    // Intercept root page loads to wrap the app runtime inside an iframe container
    if (incomingUrl.pathname === "/" || incomingUrl.pathname === "/index.html") {
      const embeddedUrl = `/proxy/${encodeURIComponent(UPSTREAM + ROBLOX_DEFAULT_PATH + incomingUrl.search)}`;
      res.writeHead(200, { "Content-Type": "text/html", ...getCorsHeaders() });
      res.end(getHtmlTemplate(embeddedUrl));
      return;
    }

    target = resolveTarget(incomingUrl);
  } catch (err: any) {
    res.writeHead(400, { "Content-Type": "text/plain", ...getCorsHeaders() });
    res.end(`Invalid or forbidden upstream URL: ${err.message}`);
    return;
  }

  const outboundHeaders = { ...req.headers };
  outboundHeaders["host"] = target.host;

  // Clean infrastructure headers
  delete outboundHeaders["x-forwarded-for"];
  delete outboundHeaders["x-forwarded-proto"];
  delete outboundHeaders["x-forwarded-host"];

  const options = {
    method: req.method,
    headers: outboundHeaders,
  };

  const upstreamReq = https.request(target, options, (upstreamRes) => {
    const responseHeaders = { ...upstreamRes.headers, ...getCorsHeaders() };

    if (upstreamRes.statusCode && [301, 302, 307, 308].includes(upstreamRes.statusCode) && responseHeaders.location) {
      try {
        const redirectUrl = new URL(responseHeaders.location, target.href);
        responseHeaders.location = `/proxy/${encodeURIComponent(redirectUrl.href)}`;
      } catch {
        // Keep default routing path if fallback parsing misses
      }
    }

    res.writeHead(upstreamRes.statusCode || 200, responseHeaders);
    upstreamRes.pipe(res);
  });

  upstreamReq.on("error", (err) => {
    console.error("Upstream Request Error:", err);
    res.writeHead(502, { "Content-Type": "text/plain", ...getCorsHeaders() });
    res.end("Bad Gateway: Proxy server could not communicate with the upstream.");
  });

  req.pipe(upstreamReq);
});

server.listen(PORT, () => {
  console.log("Proxy server successfully running under Deno.");
  console.log(`Listening on local entry: http://localhost:${PORT}/`);
});
