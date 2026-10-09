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

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, getCorsHeaders());
    res.end();
    return;
  }

  let target: URL;
  try {
    const incomingUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
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
