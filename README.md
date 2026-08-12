# CALM MCP Server

An SSE-based MCP server for **SAP Cloud ALM**, built to be hosted on **SAP BTP Cloud Foundry**.

Authentication is handled by XSUAA (bound at deploy time).  
CALM credentials are injected as **environment variables** — never hardcoded.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `CALM_BASE_URL` | ✅ | CALM API base, e.g. `https://us10.alm.cloud.sap/api` |
| `CALM_UAA_URL` | ✅ | XSUAA token endpoint, e.g. `https://<subdomain>.authentication.us10.hana.ondemand.com` |
| `CALM_CLIENT_ID` | ✅ | OAuth2 client credentials — client id |
| `CALM_CLIENT_SECRET` | ✅ | OAuth2 client credentials — client secret |
| `CALM_TIMEOUT_MS` | optional | HTTP timeout in ms (default: 30000) |
| `PORT` | auto | Set by Cloud Foundry; do not set manually |

---

## MCP Tools exposed

| Tool | Description |
|---|---|
| `calm_projects_list` | List CALM projects (filter by status) |
| `calm_projects_get` | Get a project by id |
| `calm_tasks_list` | List tasks in a project |
| `calm_tasks_get` | Get a task by id |
| `calm_tasks_create` | Create a task |
| `calm_tasks_update` | Update a task |
| `calm_tasks_delete` | Delete a task |
| `calm_features_list` | List features/requirements |
| `calm_features_get` | Get a feature by id |
| `calm_features_create` | Create a feature |
| `calm_features_update` | Update a feature |
| `calm_features_delete` | Delete a feature |
| `calm_documents_list` | List documents |
| `calm_documents_get` | Get a document |
| `calm_hierarchy_list` | List hierarchy nodes |
| `calm_processes_list` | List monitored business processes |
| `calm_analytics_query` | Query any analytics endpoint |

---

## Deploy to BTP (Cloud Foundry)

### Prerequisites
- CF CLI installed and logged in (`cf login`)
- MTA build tool: `npm install -g mbt` (or use the BTP Build Service)
- An XSUAA service instance is created automatically by `mta.yaml`

### Steps

```bash
# 1. Install deps and build TypeScript
npm install
npm run build

# 2. Build the MTA archive
mbt build

# 3. Deploy
cf deploy mta_archives/calm-mcp-server_1.0.0.mtar

# 4. Set CALM credentials as env vars (never put these in mta.yaml)
cf set-env calm-mcp-server-app CALM_CLIENT_ID     "<your-client-id>"
cf set-env calm-mcp-server-app CALM_CLIENT_SECRET "<your-client-secret>"

# 5. Restage to pick up the new env vars
cf restage calm-mcp-server-app
```

After deploy the SSE endpoint is at:
```
https://<your-app-route>.cfapps.us10.hana.ondemand.com/sse
```

### Connecting from Claude.ai
Add this URL as a remote MCP server in Claude settings. Claude will follow the `WWW-Authenticate` header to discover XSUAA and complete the OAuth flow.

---

## Local development

```bash
# Export env vars locally (do NOT commit these)
export CALM_BASE_URL="https://us10.alm.cloud.sap/api"
export CALM_UAA_URL="https://the-hackett-group-d-b-a-answerthink-inc-cloudalm.authentication.us10.hana.ondemand.com"
export CALM_CLIENT_ID="<your-client-id>"
export CALM_CLIENT_SECRET="<your-client-secret>"

# Also export a mock VCAP_SERVICES for XSUAA locally (or use cf env)
# Then:
npm run dev
```

---

## Project structure

```
calm-mcp-server/
├── src/
│   ├── index.ts        # Express app — SSE, auth middleware, tool routing
│   ├── calmClient.ts   # CALM HTTP client — OAuth token cache + API calls
│   └── tools.ts        # MCP tool definitions (schemas)
├── mta.yaml            # BTP deployment descriptor
├── xs-security.json    # XSUAA roles and redirect URIs
├── package.json
└── tsconfig.json
```
