#!/usr/bin/env node
/**
 * MCP Debug Proxy — logs all requests/responses between Claude Code and the MCP server.
 * Usage: node mcp-debug-proxy.mjs [listen-port] [target-port]
 *   Defaults: listen on 5026, forward to localhost:5025
 *
 * Then update ~/.claude.json: "url": "http://localhost:5026/mcp"
 */

import http from 'node:http';

const LISTEN_PORT = parseInt(process.argv[2] || '5026', 10);
const TARGET_PORT = parseInt(process.argv[3] || '5025', 10);
const TARGET_HOST = '127.0.0.1';

function timestamp() {
  return new Date().toISOString();
}

function logHeaders(prefix, headers) {
  for (const [k, v] of Object.entries(headers)) {
    console.log(`  ${prefix} ${k}: ${v}`);
  }
}

const server = http.createServer((clientReq, clientRes) => {
  const id = Math.random().toString(36).slice(2, 8);
  const chunks = [];

  clientReq.on('data', (chunk) => chunks.push(chunk));
  clientReq.on('end', () => {
    const body = Buffer.concat(chunks).toString();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${timestamp()}] ▶ REQUEST ${id}  ${clientReq.method} ${clientReq.url}`);
    logHeaders('→', clientReq.headers);
    if (body) {
      try {
        console.log(`  → BODY:`, JSON.stringify(JSON.parse(body), null, 2));
      } catch {
        console.log(`  → BODY:`, body.slice(0, 2000));
      }
    }

    const proxyReq = http.request(
      {
        hostname: TARGET_HOST,
        port: TARGET_PORT,
        path: clientReq.url,
        method: clientReq.method,
        headers: { ...clientReq.headers, host: `${TARGET_HOST}:${TARGET_PORT}` },
      },
      (proxyRes) => {
        const resChunks = [];
        proxyRes.on('data', (chunk) => resChunks.push(chunk));
        proxyRes.on('end', () => {
          const resBody = Buffer.concat(resChunks).toString();

          console.log(`\n[${timestamp()}] ◀ RESPONSE ${id}  ${proxyRes.statusCode} ${proxyRes.statusMessage}`);
          logHeaders('←', proxyRes.headers);
          if (resBody) {
            try {
              console.log(`  ← BODY:`, JSON.stringify(JSON.parse(resBody), null, 2));
            } catch {
              // SSE or non-JSON — print raw but truncated
              console.log(`  ← BODY:`, resBody.slice(0, 4000));
            }
          }
          console.log(`${'='.repeat(80)}\n`);

          clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
          clientRes.end(Buffer.concat(resChunks));
        });
      },
    );

    proxyReq.on('error', (err) => {
      console.error(`[${timestamp()}] ✗ PROXY ERROR ${id}:`, err.message);
      clientRes.writeHead(502);
      clientRes.end('Bad Gateway');
    });

    proxyReq.end(body);
  });
});

server.listen(LISTEN_PORT, () => {
  console.log(`MCP Debug Proxy listening on :${LISTEN_PORT} → forwarding to ${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`Update ~/.claude.json to: "url": "http://localhost:${LISTEN_PORT}/mcp"\n`);
});