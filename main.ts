// Use standard ESM imports with the node: compatibility prefix
import http from "node:http";
import https from "node:https";

// Configuration
const PORT = 8080;
const UPSTREAM = "https://now.gg";
const ROBLOX_DEFAULT_PATH = "/apps/roblox-corporation/2349/roblox.html";

function getCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Credentials": "true"
  };
}

function resolveTarget(incoming: URL): URL {
  if (incoming.pathname.startsWith("/proxy/")) {
    const encoded = incoming.pathname.slice("/proxy/".length);
    const target = new URL(decodeURIComponent(encoded));
    if (target.protocol !== "https:") {
      throw new Error("Only HTTPS upstream URLs are allowed");
    }
    if (target.hostname !== "now.gg" && !target.hostname.endsWith(".now.gg")) {
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

  // Bypassing detection by constructing completely clean, stealthy headers
  const outboundHeaders: Record<string, string> = {};

  // 1. Spoof target context & break cloud proxy signatures
  outboundHeaders["host"] = target.host;
  outboundHeaders["origin"] = "https://now.gg";
  outboundHeaders["referer"] = "https://now.gg";

  // 2. Pass standard runtime headers if they exist, but pass clean fallbacks
  outboundHeaders["user-agent"] = (req.headers["user-agent"] as string) || 
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  
  if (req.headers["accept"]) outboundHeaders["accept"] = req.headers["accept"] as string;
  if (req.headers["accept-language"]) outboundHeaders["accept-language"] = req.headers["accept-language"] as string;
  if (req.headers["accept-encoding"]) outboundHeaders["accept-encoding"] = req.headers["accept-encoding"] as string;
  if (req.headers["content-type"]) outboundHeaders["content-type"] = req.headers["content-type"] as string;
  if (req.headers["cookie"]) outboundHeaders["cookie"] = req.headers["cookie"] as string;

  // 3. Append Client Hints to look like a standard Google Chrome asset request
  outboundHeaders["sec-ch-ua"] = '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"';
  outboundHeaders["sec-ch-ua-mobile"] = "?0";
  outboundHeaders["sec-ch-ua-platform"] = '"Windows"';
  outboundHeaders["sec-fetch-dest"] = "document";
  outboundHeaders["sec-fetch-mode"] = "navigate";
  outboundHeaders["sec-fetch-site"] = "none";
  outboundHeaders["sec-fetch-user"] = "?1";
  outboundHeaders["upgrade-insecure-requests"] = "1";

  const options = {
    method: req.method,
    headers: outboundHeaders,
  };

  const upstreamReq = https.request(target, options, (upstreamRes) => {
    const responseHeaders = { ...upstreamRes.headers, ...getCorsHeaders() };

    // Update CSP and Frame options to prevent your site context from getting blocked locally
    delete responseHeaders["content-security-policy"];
    delete responseHeaders["x-frame-options"];

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
    console.error("Upstream Request Error: ", err);
    res.writeHead(502, { "Content-Type": "text/plain", ...getCorsHeaders() });
    res.end("Bad Gateway: Proxy server could not communicate with the upstream.");
  });

  req.pipe(upstreamReq);
});

server.listen(PORT, () => {
  console.log("Proxy server successfully running under Deno.");
  console.log(`Listening on local entry: http://localhost:${PORT}/`);
});
