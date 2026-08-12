/**
 * index.ts — CALM MCP Server
 *
 * Runs on SAP BTP (Cloud Foundry) as an SSE-based MCP server.
 * Auth is handled by XSUAA (bound service). CALM credentials come
 * from env vars injected by BTP at runtime:
 *
 *   CALM_BASE_URL      https://us10.alm.cloud.sap/api
 *   CALM_UAA_URL       https://<subdomain>.authentication.us10.hana.ondemand.com
 *   CALM_CLIENT_ID     (your OAuth client id)
 *   CALM_CLIENT_SECRET (your OAuth client secret)
 *
 * FIX: A fresh Server instance is created per SSE session.
 * The MCP SDK's Server class only supports one active transport at a time.
 * Reusing a singleton across reconnects triggers:
 *   "Already connected to a transport. Call close() before connecting..."
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import xsenv from '@sap/xsenv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type {} from 'passport';
import { TOOLS } from './tools.js';
import { CalmClient, readConfig } from './calmClient.js';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const xssec = require('@sap/xssec') as { JWTStrategy: new (creds: unknown) => unknown };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const passport = require('passport') as {
  use(strategy: unknown): void;
  initialize(): express.RequestHandler;
  authenticate(
    strategy: string,
    options: { session: boolean },
    callback: (err: unknown, user: unknown, info: { message?: string }) => void,
  ): express.RequestHandler;
};

// ── App setup ──────────────────────────────────────────────────────────────

const app = express();
const port = (process.env.PORT ?? 8080) as number;

// Trust BTP Gorouter so req.protocol is https, not http
app.set('trust proxy', true);

// ── CALM client ────────────────────────────────────────────────────────────

const calmConfig = readConfig();
const calm = new CalmClient(calmConfig);
console.log(`✅ CALM base URL: ${calmConfig.baseUrl}`);

// ── XSUAA (BTP auth) ──────────────────────────────────────────────────────

let uaaCredentials: Record<string, unknown>;
try {
  const services = xsenv.getServices({ uaa: { tag: 'xsuaa' } });
  uaaCredentials = services.uaa as Record<string, unknown>;
  console.log(`✅ XSUAA bound: ${uaaCredentials.url}`);
} catch {
  console.error('❌ XSUAA service binding is required. Bind the xsuaa service or check cf env.');
  process.exit(1);
}

(passport as unknown as { use(name: string, s: unknown): void })
  .use('jwt', new xssec.JWTStrategy(uaaCredentials));
app.use(passport.initialize());

// ── CORS ──────────────────────────────────────────────────────────────────

app.use(
  cors({
    origin: ['https://claude.ai', 'https://chat.openai.com', 'https://chatgpt.com'],
    credentials: true,
    exposedHeaders: ['WWW-Authenticate'],
  }),
);

// 🔥 CRITICAL: DO NOT add express.json() here.
// The MCP SDK reads the raw request stream. If Express parses it first, the SDK times out.

// ── Helpers ───────────────────────────────────────────────────────────────

type AuthRequest = Request & { authInfo?: Express.AuthInfo };

function baseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

function resourceMetadataUrl(req: Request, resourcePath: string): string {
  return `${baseUrl(req)}/.well-known/oauth-protected-resource${resourcePath}`;
}

// ── Auth middleware ────────────────────────────────────────────────────────

const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  passport.authenticate('jwt', { session: false }, (err: unknown, user: unknown, info: { message?: string }) => {
    if (err || !user) {
      res
        .status(401)
        .set(
          'WWW-Authenticate',
          `Bearer realm="calm-mcp", resource_metadata="${resourceMetadataUrl(req, req.path)}"`,
        )
        .json({ error: 'Unauthorized', details: info?.message });
      return;
    }
    req.authInfo = user;
    next();
  })(req, res, next);
};

// ── OAuth metadata endpoints (RFC 8414 + RFC 9728) ────────────────────────

const SCOPES_SUPPORTED = ['read', 'write'].map(
  (s) => `${uaaCredentials.xsappname}.${s}`,
);

app.get(
  ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'],
  (_req, res) => {
    res.json({
      issuer: uaaCredentials.url,
      authorization_endpoint: `${uaaCredentials.url}/oauth/authorize`,
      token_endpoint: `${uaaCredentials.url}/oauth/token`,
      jwks_uri: `${uaaCredentials.url}/token_keys`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      scopes_supported: SCOPES_SUPPORTED,
      subject_types_supported: ['public'],
    });
  },
);

app.get(
  ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/sse'],
  (req, res) => {
    res.json({
      resource: `${baseUrl(req)}/sse`,
      authorization_servers: [uaaCredentials.url],
      bearer_methods_supported: ['header'],
      scopes_supported: SCOPES_SUPPORTED,
    });
  },
);

// ── Sessions ──────────────────────────────────────────────────────────────

interface Session {
  transport: SSEServerTransport;
  server: Server;           // ← one Server instance per session
  heartbeat: NodeJS.Timeout | null;
}
const sessions = new Map<string, Session>();

// ── Tool handler factory ──────────────────────────────────────────────────
// Extracted so it can be registered on every per-session Server instance.

function registerToolHandlers(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    console.log(`🛠️  Tool: ${name}`);

    function str(key: string): string {
      return String(a[key] ?? '');
    }
    function odataParams(): Record<string, string> {
      const p: Record<string, string> = {};
      if (a['top'])  p['$top']  = String(a['top']);
      if (a['skip']) p['$skip'] = String(a['skip']);
      return p;
    }
    function resultText(r: unknown): string {
      return JSON.stringify(r, null, 2);
    }
    function errorText(label: string, err: string, status?: number): string {
      return `❌ ${label} failed${status ? ` (HTTP ${status})` : ''}: ${err}`;
    }

    try {
      switch (name) {
        // ── Projects ──────────────────────────────────────────────────────
        case 'calm_projects_list': {
          const params = odataParams();
          if (a['status']) params['$filter'] = `status eq '${a['status']}'`;
          const r = await calm.listProjects(params);
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_projects_list', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: resultText(r.data) }] };
        }
        case 'calm_projects_get': {
          const r = await calm.getProject(str('projectId'));
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_projects_get', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: resultText(r.data) }] };
        }

        // ── Tasks ──────────────────────────────────────────────────────────
        case 'calm_tasks_list': {
          const params = odataParams();
          if (a['status'])     params['status']     = str('status');
          if (a['assigneeId']) params['assigneeId'] = str('assigneeId');
          const r = await calm.listTasks(str('projectId'), params);
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_tasks_list', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: resultText(r.data) }] };
        }
        case 'calm_tasks_get': {
          const r = await calm.getTask(str('taskId'));
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_tasks_get', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: resultText(r.data) }] };
        }
        case 'calm_tasks_create': {
          const payload: Record<string, unknown> = {
            projectId: str('projectId'),
            title: str('title'),
          };
          if (a['description']) payload['description'] = str('description');
          if (a['status'])      payload['status']      = str('status');
          if (a['priorityId'])  payload['priorityId']  = str('priorityId');
          if (a['assigneeId'])  payload['assigneeId']  = str('assigneeId');
          if (a['dueDate'])     payload['dueDate']     = str('dueDate');
          const r = await calm.createTask(payload);
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_tasks_create', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: resultText(r.data) }] };
        }
        case 'calm_tasks_update': {
          const payload: Record<string, unknown> = {};
          for (const field of ['title', 'description', 'status', 'priorityId', 'assigneeId', 'dueDate']) {
            if (a[field] !== undefined) payload[field] = a[field];
          }
          const r = await calm.updateTask(str('taskId'), payload);
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_tasks_update', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: resultText(r.data) }] };
        }
        case 'calm_tasks_delete': {
          const r = await calm.deleteTask(str('taskId'));
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_tasks_delete', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: '✅ Task deleted.' }] };
        }

        // ── Features ──────────────────────────────────────────────────────
        case 'calm_features_list': {
          const params = odataParams();
          const filters: string[] = [`projectId eq '${str('projectId')}'`];
          if (a['statusCode'])   filters.push(`statusCode eq '${a['statusCode']}'`);
          if (a['priorityCode']) filters.push(`priorityCode eq '${a['priorityCode']}'`);
          params['$filter'] = filters.join(' and ');
          const r = await calm.listFeatures(str('projectId'), params);
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_features_list', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: resultText(r.data) }] };
        }
        case 'calm_features_get': {
          const r = await calm.getFeature(str('featureId'));
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_features_get', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: resultText(r.data) }] };
        }
        case 'calm_features_create': {
          const payload: Record<string, unknown> = {
            projectId: str('projectId'),
            title: str('title'),
          };
          for (const field of ['description', 'statusCode', 'priorityCode', 'responsibleId']) {
            if (a[field] !== undefined) payload[field] = a[field];
          }
          const r = await calm.createFeature(payload);
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_features_create', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: resultText(r.data) }] };
        }
        case 'calm_features_update': {
          const payload: Record<string, unknown> = {};
          for (const field of ['title', 'description', 'statusCode', 'priorityCode', 'responsibleId']) {
            if (a[field] !== undefined) payload[field] = a[field];
          }
          const r = await calm.updateFeature(str('featureId'), payload);
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_features_update', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: resultText(r.data) }] };
        }
        case 'calm_features_delete': {
          const r = await calm.deleteFeature(str('featureId'));
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_features_delete', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: '✅ Feature deleted.' }] };
        }

        // ── Documents ──────────────────────────────────────────────────────
        case 'calm_documents_list': {
          const params = odataParams();
          if (a['type'])   params['$filter'] = `type eq '${a['type']}'`;
          if (a['status']) {
            params['$filter'] = params['$filter']
              ? `${params['$filter']} and status eq '${a['status']}'`
              : `status eq '${a['status']}'`;
          }
          const r = await calm.listDocuments(params);
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_documents_list', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: resultText(r.data) }] };
        }
        case 'calm_documents_get': {
          const r = await calm.getDocument(str('documentId'));
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_documents_get', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: resultText(r.data) }] };
        }

        // ── Hierarchy ──────────────────────────────────────────────────────
        case 'calm_hierarchy_list': {
          const params = odataParams();
          if (a['parentId']) params['$filter'] = `parentId eq '${a['parentId']}'`;
          const r = await calm.listHierarchy(params);
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_hierarchy_list', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: resultText(r.data) }] };
        }

        // ── Process Monitoring ─────────────────────────────────────────────
        case 'calm_processes_list': {
          const r = await calm.listBusinessProcesses(odataParams());
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_processes_list', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: resultText(r.data) }] };
        }

        // ── Analytics ──────────────────────────────────────────────────────
        case 'calm_analytics_query': {
          const extraParams = (a['params'] as Record<string, string> | undefined) ?? {};
          const r = await calm.queryAnalytics(str('endpoint'), extraParams);
          if (!r.ok) return { content: [{ type: 'text', text: errorText('calm_analytics_query', r.error, r.status) }], isError: true };
          return { content: [{ type: 'text', text: resultText(r.data) }] };
        }

        default:
          return { content: [{ type: 'text', text: `❌ Unknown tool: ${name}` }], isError: true };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `❌ Unexpected error in ${name}: ${msg}` }], isError: true };
    }
  });
}

// ── SSE endpoint ──────────────────────────────────────────────────────────
// KEY FIX: create a NEW Server instance for every SSE connection.
// The MCP SDK Server class only allows one active transport at a time, so
// reusing a singleton causes "Already connected to a transport" on reconnect.

app.get('/sse', authMiddleware, async (req: AuthRequest, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Fresh Server per session — avoids the "already connected" error
  const server = new Server(
    { name: 'calm-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  registerToolHandlers(server);

  const transport = new SSEServerTransport('/messages', res);
  const sessionId = transport.sessionId;
  sessions.set(sessionId, { transport, server, heartbeat: null });
  console.log(`🔌 SSE session opened: ${sessionId}`);

  try {
    await server.connect(transport);

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': keep-alive\n\n');
    }, 15_000);

    const session = sessions.get(sessionId);
    if (session) session.heartbeat = heartbeat;
  } catch (err) {
    console.error(`❌ MCP connect failed: ${(err as Error).message}`);
    sessions.delete(sessionId);
  }

  req.on('close', () => {
    const session = sessions.get(sessionId);
    if (session?.heartbeat) clearInterval(session.heartbeat);
    sessions.delete(sessionId);
    console.log(`⚠️  SSE session closed: ${sessionId}`);
  });
});

// ── Messages endpoint ─────────────────────────────────────────────────────

const messageHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const sessionId = req.query['sessionId'] as string;
  const session = sessions.get(sessionId);
  if (!session) {
    console.error(`❌ Session ${sessionId} not found. Active sessions:`, Array.from(sessions.keys()));
    res.status(400).json({ error: 'Session not found — reconnect required.' });
    return;
  }
  try {
    await session.transport.handlePostMessage(req, res);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

app.post('/messages', authMiddleware, messageHandler);
app.post('/sse', authMiddleware, messageHandler);

// ── Health check ──────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'calm-mcp-server', version: '1.0.0', activeSessions: sessions.size });
});

// ── Start ─────────────────────────────────────────────────────────────────

app.listen(port, () => {
  console.log(`🚀 CALM MCP Server listening on port ${port}`);
});
