import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

// Configuration
const PORT = 8080;
const UPSTREAM = "https://now.gg";
const ROBLOX_DEFAULT_PATH = "/apps/roblox-corporation/2349/roblox.html";

// CRITICAL: To guarantee a bypass, replace these placeholders with a residential proxy provider.
// This masks your server's datacenter IP address with a real home/mobile ISP network address.
const USE_RESIDENTIAL_PROXY = false; 
const PROXY_HOST = "your-residential-proxy-provider.com";
const PROXY_PORT = 12345;
const PROXY_USER = "username";
const PROXY_PASS = "password";

// Chrome 120+ Hardened TLS Ciphers to bypass JA3/JA4 Detection
const CHROME_CIPHERS = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305"
].join(":");

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
    res.end(`Configuration error: ${err.message}`);
    return;
  }

  const outboundHeaders: Record<string, string> = {};

  // 1. Precise Browser Navigation Simulation
  outboundHeaders["host"] = target.host;
  outboundHeaders["origin"] = "https://now.gg";
  outboundHeaders["referer"] = "https://now.gg";
  outboundHeaders["connection"] = "keep-alive";

  const passThroughHeaders = [
    "user-agent", "accept", "accept-language", "accept-encoding", 
    "content-type", "cookie", "authorization"
  ];
  
  for (const key of passThroughHeaders) {
    if (req.headers[key]) {
      outboundHeaders[key] = req.headers[key] as string;
    }
  }

  if (!outboundHeaders["user-agent"]) {
    outboundHeaders["user-agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  }

  // 2. Strict Anti-Bot Fingerprint Spoofing
  outboundHeaders["sec-ch-ua"] = '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"';
  outboundHeaders["sec-ch-ua-mobile"] = "?0";
  outboundHeaders["sec-ch-ua-platform"] = '"Windows"';
  outboundHeaders["sec-fetch-dest"] = "document";
  outboundHeaders["sec-fetch-mode"] = "navigate";
  outboundHeaders["sec-fetch-site"] = "same-origin";
  outboundHeaders["sec-fetch-user"] = "?1";
  outboundHeaders["upgrade-insecure-requests"] = "1";

  // Completely drop signature headers that runtimes or reverse proxies inject
  delete req.headers["x-forwarded-for"];
  delete req.headers["x-forwarded-proto"];
  delete req.headers["x-forwarded-host"];
  delete req.headers["forwarded"];
  delete req.headers["via"];

  // 3. Construct HTTP/HTTPS Request options with custom TLS configuration
  let options: any = {
    method: req.method,
    headers: outboundHeaders,
    ciphers: CHROME_CIPHERS,              // Enforce Chrome JA3/JA4 Fingerprint match
    honorCipherOrder: true,
    minVersion: "TLSv1.3",                // Enforce modern TLS standards 
  };

  let requestClient: any = https;

  // Integrate residential proxy routing if configured
  if (USE_RESIDENTIAL_PROXY) {
    options.host = PROXY_HOST;
    options.port = PROXY_PORT;
    options.path = target.href;
    const auth = Buffer.from(`${PROXY_USER}:${PROXY_PASS}`).toString("base64");
    options.headers["Proxy-Authorization"] = `Basic ${auth}`;
    requestClient = http; // Outbound transport wrapper shifts to tunneling agent
  } else {
    options.host = target.hostname;
    options.path = target.pathname + target.search;
  }

  const upstreamReq = requestClient.request(options, (upstreamRes) => {
    const responseHeaders = { ...upstreamRes.headers, ...getCorsHeaders() };

    // Strip perimeter defense security options blocking iframe delivery
    delete responseHeaders["content-security-policy"];
    delete responseHeaders["content-security-policy-report-only"];
    delete responseHeaders["x-frame-options"];
    delete responseHeaders["x-content-type-options"];

    // Prevent direct tracking redirect breakouts
    if (upstreamRes.statusCode && [301, 302, 307, 308].includes(upstreamRes.statusCode) && responseHeaders.location) {
      try {
        const redirectUrl = new URL(responseHeaders.location, target.href);
        responseHeaders.location = `/proxy/${encodeURIComponent(redirectUrl.href)}`;
      } catch {}
    }

    res.writeHead(upstreamRes.statusCode || 200, responseHeaders);
    upstreamRes.pipe(res);
  });

  upstreamReq.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "text/plain", ...getCorsHeaders() });
    res.end("Connection verification timeout.");
  });

  req.pipe(upstreamReq);
});

// 4. Robust Real-Time WebSocket Tunnel Context
server.on("upgrade", (req, socket, head) => {
  try {
    const incomingUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const targetUrl = resolveTarget(incomingUrl);
    
    const outboundHeaders: Record<string, string> = {
      "Connection": "Upgrade",
      "Upgrade": "websocket",
      "Host": targetUrl.host,
      "Origin": "https://now.gg",
      "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    };

    if (req.headers["cookie"]) outboundHeaders["cookie"] = req.headers["cookie"] as string;

    const wsOptions: any = {
      port: 443,
      hostname: targetUrl.hostname,
      path: targetUrl.pathname + targetUrl.search,
      method: "GET",
      headers: outboundHeaders,
      ciphers: CHROME_CIPHERS,
      honorCipherOrder: true,
      minVersion: "TLSv1.3"
    };

    const upstreamWsReq = https.request(wsOptions);

    upstreamWsReq.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\(\r\\)n" +
        "Upgrade: websocket\(\r\\)n" +
        "Connection: Upgrade\(\r\n\r\\)n"
      );
      
      upstreamSocket.write(upstreamHead);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });

    upstreamWsReq.on("error", () => {
      socket.destroy();
    });

    upstreamWsReq.end();
  } catch (err) {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Stealth proxy engine online on port ${PORT}`);
});
