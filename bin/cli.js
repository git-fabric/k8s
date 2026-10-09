#!/usr/bin/env node
import { createApp } from '../dist/app.js';
import { Library } from '../dist/library.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'node:http';

const app = createApp();
const library = new Library();

function buildServer() {
  const server = new Server({ name: app.name, version: app.version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: app.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, ...(t.annotations && { annotations: t.annotations }) })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = app.tools.find((t) => t.name === req.params.name);
    if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true };
    try {
      const result = await tool.execute(req.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: String(e) }], isError: true };
    }
  });

  return server;
}

// ── Gateway registration ─────────────────────────────────────────────────────

const GATEWAY_URL = process.env.GATEWAY_URL;
const MCP_HTTP_PORT = process.env.MCP_HTTP_PORT ? Number(process.env.MCP_HTTP_PORT) : null;
const POD_IP = process.env.POD_IP || '0.0.0.0';

let sessionToken = null;

async function registerWithGateway() {
  if (!GATEWAY_URL) return;
  const mcpEndpoint = `http://${POD_IP}:${MCP_HTTP_PORT || 8200}/mcp`;
  const body = {
    fabric_id: 'fabric-k8s',
    as_number: 65002,
    version: app.version,
    mcp_endpoint: mcpEndpoint,
    ollama_endpoint: process.env.OLLAMA_ENDPOINT || 'http://ollama.fabric-sdk:11434',
    ollama_model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b',
    supervisor: 'standalone',
    tailscale_node: 'fabric-k8s',
    worker_pool: { total: 0, healthy: 0, workers: [] },
    routes: [
      { prefix: 'fabric.k8s', local_pref: 100, confidence_floor: 0.7, description: 'Kubernetes cluster operations — pods, deployments, services, nodes, events' },
      { prefix: 'fabric.k8s.pods', local_pref: 100, confidence_floor: 0.7, description: 'Pod management — list, describe, logs, problems' },
      { prefix: 'fabric.k8s.deployments', local_pref: 100, confidence_floor: 0.7, description: 'Deployment management — list, describe, rollout status' },
      { prefix: 'fabric.k8s.services', local_pref: 100, confidence_floor: 0.7, description: 'Service management — list, describe' },
      { prefix: 'fabric.k8s.nodes', local_pref: 100, confidence_floor: 0.7, description: 'Node management — list, describe, capacity' },
      { prefix: 'fabric.k8s.events', local_pref: 100, confidence_floor: 0.7, description: 'Cluster events — warnings, failures, scheduling' },
      { prefix: 'fabric.k8s.storage', local_pref: 100, confidence_floor: 0.7, description: 'PVCs and Longhorn volumes' },
      { prefix: 'fabric.k8s.argocd', local_pref: 100, confidence_floor: 0.7, description: 'ArgoCD applications — sync status, health, deploy history' },
      { prefix: 'fabric.k8s.ingress', local_pref: 100, confidence_floor: 0.7, description: 'Traefik IngressRoutes — routing rules and entrypoints' },
      { prefix: 'fabric.k8s.jobs', local_pref: 100, confidence_floor: 0.7, description: 'CronJobs and Jobs — schedules, completions, status' },
    ],
  };

  try {
    const res = await fetch(`${GATEWAY_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) {
      sessionToken = data.session_token;
      console.log(`[fabric-k8s] Registered with gateway: ${sessionToken} (${data.routes_accepted} routes)`);
    } else {
      console.warn(`[fabric-k8s] Registration rejected: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.warn(`[fabric-k8s] Gateway registration failed (standalone mode): ${err.message}`);
  }
}

async function sendKeepalive() {
  if (!GATEWAY_URL || !sessionToken) return;
  try {
    const res = await fetch(`${GATEWAY_URL}/keepalive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fabric_id: 'fabric-k8s',
        session_token: sessionToken,
        worker_pool: { total: 0, healthy: 0, workers: [] },
        timestamp: Math.floor(Date.now() / 1000),
      }),
    });
    if (res.status === 401) {
      console.log('[fabric-k8s] Session expired — re-registering');
      sessionToken = null;
      await registerWithGateway();
    }
  } catch {
    // Gateway unreachable — will retry next interval
  }
}

// ── Server startup ───────────────────────────────────────────────────────────

const httpPort = MCP_HTTP_PORT;

if (httpPort) {
  const httpServer = createServer(async (req, res) => {
    if (req.url === '/healthz' || req.url === '/health') {
      const h = await app.health();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(h));
      return;
    }
    if (req.url === '/tools') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(app.tools.map((t) => ({ name: t.name, description: t.description }))));
      return;
    }
    // MCP tool call endpoint for gateway DNS unicast resolution
    if ((req.url === '/mcp/tools/call' || req.url === '/tools/call') && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());

      // Handle aiana_query — gateway DNS resolver asks for context
      //
      // Two knowledge sources, checked in order:
      //   1. Live cluster (deterministic) — real-time state from k8s API
      //   2. Library (reference) — k3s docs + source, fetched from git on demand
      //
      // Live cluster answers "what IS" — library answers "how to" and "why"
      if (body.name === 'aiana_query') {
        const queryText = (body.arguments?.query_text || '').toLowerCase();
        try {
          let context = '';
          let confidence = 0;
          let source = 'cluster';

          // ── Live cluster queries (real-time state) ─────────────────
          if (queryText.includes('pod') && queryText.includes('problem') || queryText.includes('crash') || queryText.includes('fail')) {
            const problems = await app.tools.find(t => t.name === 'k8s_pod_problems')?.execute({});
            context = JSON.stringify(problems, null, 2);
            confidence = problems && Array.isArray(problems) && problems.length > 0 ? 0.9 : 0.7;
          } else if (/\b(list|show|get|what)\b.*\b(pod|running|container)s?\b/.test(queryText) && !queryText.includes('how')) {
            const ns = queryText.match(/namespace\s+(\S+)/)?.[1] || queryText.match(/in\s+(\S+)\s/)?.[1];
            const pods = await app.tools.find(t => t.name === 'k8s_list_pods')?.execute(ns ? { namespace: ns } : {});
            context = JSON.stringify(pods, null, 2);
            confidence = 0.95;
          } else if (/\b(list|show|get|what)\b.*\bdeploy/.test(queryText) && !queryText.includes('how')) {
            const ns = queryText.match(/namespace\s+(\S+)/)?.[1];
            const deploys = await app.tools.find(t => t.name === 'k8s_list_deployments')?.execute(ns ? { namespace: ns } : {});
            context = JSON.stringify(deploys, null, 2);
            confidence = 0.95;
          } else if (/\b(list|show|get|what)\b.*\bnodes?\b/.test(queryText) && !queryText.includes('how')) {
            const nodes = await app.tools.find(t => t.name === 'k8s_list_nodes')?.execute({});
            context = JSON.stringify(nodes, null, 2);
            confidence = 0.95;
          } else if (/\b(list|show|get|what)\b.*\bservices?\b/.test(queryText) && !queryText.includes('how')) {
            const ns = queryText.match(/namespace\s+(\S+)/)?.[1];
            const svcs = await app.tools.find(t => t.name === 'k8s_list_services')?.execute(ns ? { namespace: ns } : {});
            context = JSON.stringify(svcs, null, 2);
            confidence = 0.95;
          } else if (/\b(list|show|get)\b.*\b(event|warning)/.test(queryText)) {
            const events = await app.tools.find(t => t.name === 'k8s_list_events')?.execute({});
            context = JSON.stringify(events, null, 2);
            confidence = 0.85;
          } else if (/\b(list|show|get)\b.*\b(argocd|argo)\b/.test(queryText)) {
            const apps = await app.tools.find(t => t.name === 'k8s_list_argocd_apps')?.execute({});
            context = JSON.stringify(apps, null, 2);
            confidence = 0.95;
          } else if (/\b(list|show|get)\b.*\b(longhorn|volume|pvc)\b/.test(queryText)) {
            const vols = await app.tools.find(t => t.name === 'k8s_list_longhorn_volumes')?.execute({});
            context = JSON.stringify(vols, null, 2);
            confidence = 0.85;
          } else if (/\b(list|show|get)\b.*\b(ingress|route|traefik)\b/.test(queryText)) {
            const routes = await app.tools.find(t => t.name === 'k8s_list_ingress_routes')?.execute({});
            context = JSON.stringify(routes, null, 2);
            confidence = 0.85;
          } else {
            // ── Library queries (reference docs) ──────────────────────
            // Not a live cluster query — check the library
            const libraryResult = await library.query(queryText);
            if (libraryResult && libraryResult.context) {
              context = libraryResult.context;
              confidence = libraryResult.confidence;
              source = 'library';
              console.log(`[fabric-k8s] Library hit: ${libraryResult.sources.join(', ')}`);
            } else {
              // Nothing in library either — return cluster info as fallback
              const info = await app.tools.find(t => t.name === 'k8s_cluster_info')?.execute({});
              context = JSON.stringify(info, null, 2);
              confidence = 0.5;
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ context, confidence, source }));
        } catch (err) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ context: `Error querying k8s: ${err.message}`, confidence: 0 }));
        }
        return;
      }

      const tool = app.tools.find((t) => t.name === body.name);
      if (!tool) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Tool not found: ${body.name}` }));
        return;
      }
      try {
        const result = await tool.execute(body.arguments ?? {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (req.url === '/mcp' || req.url === '/') {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = buildServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, undefined);
      return;
    }
    res.writeHead(404).end('not found');
  });

  httpServer.listen(httpPort, () => {
    console.log(`[fabric-k8s] ${app.name} v${app.version} — ${app.tools.length} tools`);
    console.log(`[fabric-k8s] MCP server listening on :${httpPort}`);
    console.log(`[fabric-k8s] Endpoints: /health /tools /tools/call /mcp/tools/call /mcp`);
  });

  // Register with gateway after server is listening
  await registerWithGateway();

  // Keepalive every 30s
  if (GATEWAY_URL) {
    setInterval(sendKeepalive, 30_000);
  }
} else {
  const transport = new StdioServerTransport();
  const server = buildServer();
  await server.connect(transport);
}
