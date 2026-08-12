/**
 * calmClient.ts
 *
 * Lightweight Cloud ALM API client.
 * Auth credentials come exclusively from environment variables — no
 * .env file or BTP service binding needed when deployed on BTP with
 * env vars injected at runtime.
 *
 * Required env vars (set externally — never hardcoded here):
 *   CALM_BASE_URL          e.g. https://us10.alm.cloud.sap/api
 *   CALM_UAA_URL           e.g. https://<subdomain>.authentication.us10.hana.ondemand.com
 *   CALM_CLIENT_ID         OAuth2 client_credentials client id
 *   CALM_CLIENT_SECRET     OAuth2 client_credentials client secret
 *
 * Optional:
 *   CALM_TIMEOUT_MS        HTTP timeout in ms (default: 30000)
 */

// ─── Config ─────────────────────────────────────────────────────────────────

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[calm-mcp] env var ${name} is required but not set.`);
  return v;
}

export interface CalmConfig {
  baseUrl: string;
  uaaUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
}

export function readConfig(): CalmConfig {
  return {
    baseUrl: required('CALM_BASE_URL').replace(/\/$/, ''),
    uaaUrl: required('CALM_UAA_URL').replace(/\/$/, ''),
    clientId: required('CALM_CLIENT_ID'),
    clientSecret: required('CALM_CLIENT_SECRET'),
    timeoutMs: process.env.CALM_TIMEOUT_MS ? Number(process.env.CALM_TIMEOUT_MS) : 30_000,
  };
}

// ─── Token cache ─────────────────────────────────────────────────────────────

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}

let _tokenCache: TokenCache | null = null;

async function fetchToken(cfg: CalmConfig): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 60_000) {
    return _tokenCache.token;
  }

  const url = `${cfg.uaaUrl}/oauth/token`;
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`XSUAA token request failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('XSUAA response missing access_token');

  _tokenCache = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };
  return _tokenCache.token;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  ok: true;
  data: T;
  status: number;
}

export interface ApiError {
  ok: false;
  error: string;
  status?: number;
}

export type ApiResult<T = unknown> = ApiResponse<T> | ApiError;

async function calmFetch<T>(
  cfg: CalmConfig,
  method: string,
  path: string,
  params?: Record<string, string>,
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const token = await fetchToken(cfg);
    const url = new URL(`${cfg.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });

    const text = await res.text();
    const data = text ? safeJson(text) : undefined;

    if (!res.ok) {
      const message = extractErrorMessage(data) ?? text.slice(0, 300);
      return { ok: false, error: message, status: res.status };
    }

    return { ok: true, data: data as T, status: res.status };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

function extractErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, unknown>;
  // OData error shape
  const odataMsg = (d?.error as Record<string, unknown>)?.message;
  if (typeof odataMsg === 'string') return odataMsg;
  if (odataMsg && typeof odataMsg === 'object') {
    const inner = (odataMsg as Record<string, unknown>)?.value;
    if (typeof inner === 'string') return inner;
  }
  if (typeof d?.message === 'string') return d.message;
  return undefined;
}

// ─── CALM API surface ─────────────────────────────────────────────────────────

export class CalmClient {
  constructor(private readonly cfg: CalmConfig) {}

  // ── Projects ──────────────────────────────────────────────────────────────
  listProjects(params?: Record<string, string>) {
    return calmFetch(this.cfg, 'GET', '/calm-processmanagement/v1/projects', params);
  }

  getProject(projectId: string) {
    return calmFetch(this.cfg, 'GET', `/calm-processmanagement/v1/projects/${encodeURIComponent(projectId)}`);
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────
  listTasks(projectId: string, params?: Record<string, string>) {
    return calmFetch(this.cfg, 'GET', '/calm-tasks/v1/tasks', { projectId, ...params });
  }

  getTask(taskId: string) {
    return calmFetch(this.cfg, 'GET', `/calm-tasks/v1/tasks/${encodeURIComponent(taskId)}`);
  }

  createTask(payload: unknown) {
    return calmFetch(this.cfg, 'POST', '/calm-tasks/v1/tasks', undefined, payload);
  }

  updateTask(taskId: string, payload: unknown) {
    return calmFetch(this.cfg, 'PATCH', `/calm-tasks/v1/tasks/${encodeURIComponent(taskId)}`, undefined, payload);
  }

  deleteTask(taskId: string) {
    return calmFetch(this.cfg, 'DELETE', `/calm-tasks/v1/tasks/${encodeURIComponent(taskId)}`);
  }

  // ── Features ──────────────────────────────────────────────────────────────
  listFeatures(projectId: string, params?: Record<string, string>) {
    return calmFetch(this.cfg, 'GET', '/calm-requirements/v1/features', {
      '$filter': `projectId eq '${projectId}'`,
      ...params,
    });
  }

  getFeature(featureId: string) {
    return calmFetch(this.cfg, 'GET', `/calm-requirements/v1/features/${encodeURIComponent(featureId)}`);
  }

  createFeature(payload: unknown) {
    return calmFetch(this.cfg, 'POST', '/calm-requirements/v1/features', undefined, payload);
  }

  updateFeature(featureId: string, payload: unknown) {
    return calmFetch(this.cfg, 'PATCH', `/calm-requirements/v1/features/${encodeURIComponent(featureId)}`, undefined, payload);
  }

  deleteFeature(featureId: string) {
    return calmFetch(this.cfg, 'DELETE', `/calm-requirements/v1/features/${encodeURIComponent(featureId)}`);
  }

  // ── Documents ─────────────────────────────────────────────────────────────
  listDocuments(params?: Record<string, string>) {
    return calmFetch(this.cfg, 'GET', '/calm-processmanagement/v1/documents', params);
  }

  getDocument(documentId: string) {
    return calmFetch(this.cfg, 'GET', `/calm-processmanagement/v1/documents/${encodeURIComponent(documentId)}`);
  }

  // ── Hierarchy ─────────────────────────────────────────────────────────────
  listHierarchy(params?: Record<string, string>) {
    return calmFetch(this.cfg, 'GET', '/calm-processmanagement/v1/hierarchy', params);
  }

  // ── Process Monitoring ────────────────────────────────────────────────────
  listBusinessProcesses(params?: Record<string, string>) {
    return calmFetch(this.cfg, 'GET', '/calm-processmonitoring/v1/businessProcesses', params);
  }

  // ── Analytics ─────────────────────────────────────────────────────────────
  queryAnalytics(endpoint: string, params?: Record<string, string>) {
    return calmFetch(this.cfg, 'GET', `/calm-analytics/v1/${endpoint}`, params);
  }
}
