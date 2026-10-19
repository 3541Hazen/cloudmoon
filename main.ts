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

  // FIXED: Sanitizing outbound headers to strip Cloudflare/Deno/Proxy signatures
  const outboundHeaders: Record<string, string> = {};

  // 1. Force context spoofing 
  outboundHeaders["host"] = target.host;
  outboundHeaders["origin"] = "https://now.gg";
  outboundHeaders["referer"] = "https://now.gg";

  // 2. Map allowed client headers while dropping internal proxy flags (Forwarded, X-Forwarded-For, etc.)
  const allowedHeaders = [
    "user-agent", "accept", "accept-language", "accept-encoding", 
    "content-type", "cookie", "authorization", "cache-control"
  ];
  
  for (const key of allowedHeaders) {
    if (req.headers[key]) {
      outboundHeaders[key] = req.headers[key] as string;
    }
  }

  // Fallback high-reputation UA if missing
  if (!outboundHeaders["user-agent"]) {
    outboundHeaders["user-agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  }

  // 3. Strict modern browser Client Hints (Now matching real desktop navigation)
  outboundHeaders["sec-ch-ua"] = '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"';
  outboundHeaders["sec-ch-ua-mobile"] = "?0";
  outboundHeaders["sec-ch-ua-platform"] = '"Windows"';
  outboundHeaders["sec-fetch-dest"] = "document";
  outboundHeaders["sec-fetch-mode"] = "navigate";
  outboundHeaders["sec-fetch-site"] = "same-origin"; // FIXED: Changed from 'none' to spoof actual internal asset requests
  outboundHeaders["sec-fetch-user"] = "?1";
  outboundHeaders["upgrade-insecure-requests"] = "1";

  const options = {
    method: req.method,
    headers: outboundHeaders,
  };

  const upstreamReq = https.request(target, options, (upstreamRes) => {
    const responseHeaders = { ...upstreamRes.headers, ...getCorsHeaders() };

    // 4. Strip aggressive security policies blocking custom client rendering
    delete responseHeaders["content-security-policy"];
    delete responseHeaders["content-security-policy-report-only"];
    delete responseHeaders["x-frame-options"];

    // FIXED: Sanitize and force re-routing on edge redirect attempts 
    if (upstreamRes.statusCode && [301, 302, 307, 308].includes(upstreamRes.statusCode) && responseHeaders.location) {
      try {
        const redirectUrl = new URL(responseHeaders.location, target.href);
        responseHeaders.location = `/proxy/${encodeURIComponent(redirectUrl.href)}`;
      } catch {
        // Fallback route context
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

// FIXED: Added basic WebSocket proxy logic. Cloud gaming frames run entirely over WebSockets (WS/WSS).
// Without handling the 'upgrade' event, the engine loop fails and throws a VPN/Network connection block error.
server.on('upgrade', (req, socket, head) => {
  try {
    const incomingUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const targetUrl = resolveTarget(incomingUrl);
    
    // Convert to target websocket protocol
    const wsTargetUrl = new URL(targetUrl.href);
    wsTargetUrl.protocol = targetUrl.protocol === 'https:' ? 'wss:' : 'ws:';

    const upstreamWsReq = https.request(targetUrl, {
      method: 'GET',
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Host': targetUrl.host,
        'Origin': 'https://now.gg',
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    upstreamWsReq.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      socket.write('HTTP/1.1 101 Switching Protocols\(\r\n' + 'Upgrade: websocket\r\n' + 'Connection: Upgrade\r\n\r\\)n');
      
      upstreamSocket.write(upstreamHead);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });

    upstreamWsReq.on('error', () => {
      socket.destroy();
    });

    upstreamWsReq.end();
  } catch (err) {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log("Proxy server successfully running under Deno/Node.");
  console.log(`Listening on local entry: http://localhost:${PORT}/`);
});
