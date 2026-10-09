const http = require('http');
const https = require('https');

// Configuration
const PORT = 8080;
const UPSTREAM = "https://now.gg";
const ROBLOX_DEFAULT_PATH = "/apps/roblox-corporation/2349/roblox.html";

// Helper for default CORS headers
function getCorsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*'
    };
}

// 1. Correct URL Routing Logic (Fixed to handle local -> upstream mappings seamlessly)
function resolveTarget(incoming) {
    // If requesting through an explicit proxy path
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

    // Default fallback to the main Roblox application path
    const path = (incoming.pathname === "/" || incoming.pathname === "/index.html")
        ? ROBLOX_DEFAULT_PATH
        : incoming.pathname;

    return new URL(path + incoming.search, UPSTREAM);
}

// 2. The Main Proxy Request Handler
const server = http.createServer((req, res) => {
    // Handle preflight OPTIONS requests immediately
    if (req.method === 'OPTIONS') {
        res.writeHead(204, getCorsHeaders());
        res.end();
        return;
    }

    let target;
    try {
        // Construct the full local URL to parse out parameters reliably
        const incomingUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        target = resolveTarget(incomingUrl);
    } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain', ...getCorsHeaders() });
        res.end(`Invalid or forbidden upstream URL: ${err.message}`);
        return;
    }

    // Construct the outbound headers safely
    const outboundHeaders = { ...req.headers };
    outboundHeaders['host'] = target.host;
    
    // Do not attempt network-level IP spoofing via headers as upstreams look at the socket layer.
    // Clean out potential conflicting headers to maintain protocol integrity.
    delete outboundHeaders['x-forwarded-for'];
    delete outboundHeaders['x-forwarded-proto'];
    delete outboundHeaders['x-forwarded-host'];

    // Options for the HTTPS forward request
    const options = {
        method: req.method,
        headers: outboundHeaders,
    };

    // Forward the request to the upstream target safely over HTTPS
    const upstreamReq = https.request(target, options, (upstreamRes) => {
        const responseHeaders = { ...upstreamRes.headers, ...getCorsHeaders() };

        // Fix 3. Correct Redirect Handling
        // If the upstream issues a 301/302 redirect, check if it drops the hostname.
        // We route cross-origin redirects through our local proxy routing endpoint to preserve server tracking.
        if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode) && responseHeaders.location) {
            try {
                const redirectUrl = new URL(responseHeaders.location, target.href);
                // Rewrite location to keep the user trapped inside the local proxy context safely
                responseHeaders.location = `/proxy/${encodeURIComponent(redirectUrl.href)}`;
            } catch (e) {
                // If it fails parsing, keep original header to avoid breaking standard pathways
            }
        }

        // Fix 4. Remove fragile DOM injections. 
        // Stream the data completely unmodified to preserve iframe sandboxes, window.top hierarchy, and script layouts.
        res.writeHead(upstreamRes.statusCode, responseHeaders);
        upstreamRes.pipe(res);
    });

    upstreamReq.on('error', (err) => {
        console.error('Upstream Request Error:', err);
        res.writeHead(502, { 'Content-Type': 'text/plain', ...getCorsHeaders() });
        res.end('Bad Gateway: Proxy server could not communicate with the upstream.');
    });

    // Pipe the client's original payload (POST bodies, uploads) up to the target
    req.pipe(upstreamReq);
});

// Launch Server
server.listen(PORT, () => {
    console.log(`Proxy listening on port: ${PORT}`);
    console.log(`Default Application entry: http://localhost:${PORT}/`);
});
