/**
 * tools.ts
 * MCP tool definitions exposed by the CALM MCP server.
 */

export const TOOLS = [
  // ── Projects ──────────────────────────────────────────────────────────────
  {
    name: 'calm_projects_list',
    description:
      'List Cloud ALM projects. Optionally filter by status. Returns id, name, status, type, and modifiedAt by default.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: "Filter by project status, e.g. 'ACTIVE', 'CLOSED'.",
        },
        top: {
          type: 'integer',
          description: 'Max number of results (default 50, max 200).',
          minimum: 1,
          maximum: 200,
        },
        skip: {
          type: 'integer',
          description: 'Zero-based offset for pagination.',
          minimum: 0,
        },
      },
    },
  },
  {
    name: 'calm_projects_get',
    description: 'Get full details for a single Cloud ALM project by its id.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string', description: 'Project UUID.' },
      },
    },
  },

  // ── Tasks ─────────────────────────────────────────────────────────────────
  {
    name: 'calm_tasks_list',
    description:
      'List tasks in a Cloud ALM project. Filter by status or assigneeId. Returns id, title, status, assigneeId, dueDate.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: {
          type: 'string',
          description: 'Project UUID (required scope).',
        },
        status: {
          type: 'string',
          description: "e.g. 'OPEN', 'IN_PROGRESS', 'DONE'.",
        },
        assigneeId: { type: 'string', description: 'Filter by assignee UUID.' },
        top: { type: 'integer', minimum: 1, maximum: 200 },
        skip: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'calm_tasks_get',
    description: 'Get full details for a single Cloud ALM task.',
    inputSchema: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: { type: 'string', description: 'Task UUID.' },
      },
    },
  },
  {
    name: 'calm_tasks_create',
    description: 'Create a new task in a Cloud ALM project.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'title'],
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string', description: 'Task title (required).' },
        description: { type: 'string' },
        status: { type: 'string' },
        priorityId: { type: 'string' },
        assigneeId: { type: 'string' },
        dueDate: {
          type: 'string',
          description: 'ISO-8601 date, e.g. 2025-12-31.',
        },
      },
    },
  },
  {
    name: 'calm_tasks_update',
    description: 'Update fields on an existing Cloud ALM task (PATCH).',
    inputSchema: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string' },
        priorityId: { type: 'string' },
        assigneeId: { type: 'string' },
        dueDate: { type: 'string' },
      },
    },
  },
  {
    name: 'calm_tasks_delete',
    description: 'Delete a Cloud ALM task by its id.',
    inputSchema: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: { type: 'string' },
      },
    },
  },

  // ── Features ──────────────────────────────────────────────────────────────
  {
    name: 'calm_features_list',
    description:
      'List Cloud ALM features (requirements) for a project. Filter by statusCode or priorityCode.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string', description: 'Project UUID.' },
        statusCode: {
          type: 'string',
          description: "e.g. 'OPEN', 'IN_PROGRESS', 'CLOSED'.",
        },
        priorityCode: { type: 'string' },
        top: { type: 'integer', minimum: 1, maximum: 200 },
        skip: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'calm_features_get',
    description: 'Get full details for a single Cloud ALM feature.',
    inputSchema: {
      type: 'object',
      required: ['featureId'],
      properties: {
        featureId: { type: 'string', description: 'Feature UUID.' },
      },
    },
  },
  {
    name: 'calm_features_create',
    description: 'Create a new feature/requirement in a Cloud ALM project.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'title'],
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        statusCode: { type: 'string' },
        priorityCode: { type: 'string' },
        responsibleId: { type: 'string' },
      },
    },
  },
  {
    name: 'calm_features_update',
    description: 'Update a Cloud ALM feature (PATCH).',
    inputSchema: {
      type: 'object',
      required: ['featureId'],
      properties: {
        featureId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        statusCode: { type: 'string' },
        priorityCode: { type: 'string' },
        responsibleId: { type: 'string' },
      },
    },
  },
  {
    name: 'calm_features_delete',
    description: 'Delete a Cloud ALM feature by its id.',
    inputSchema: {
      type: 'object',
      required: ['featureId'],
      properties: {
        featureId: { type: 'string' },
      },
    },
  },

  // ── Documents ─────────────────────────────────────────────────────────────
  {
    name: 'calm_documents_list',
    description: 'List Cloud ALM documents. Filter by type or status.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        status: { type: 'string' },
        top: { type: 'integer', minimum: 1, maximum: 200 },
        skip: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'calm_documents_get',
    description: 'Get a single Cloud ALM document by id.',
    inputSchema: {
      type: 'object',
      required: ['documentId'],
      properties: {
        documentId: { type: 'string' },
      },
    },
  },

  // ── Hierarchy ─────────────────────────────────────────────────────────────
  {
    name: 'calm_hierarchy_list',
    description: 'List nodes in the Cloud ALM process hierarchy.',
    inputSchema: {
      type: 'object',
      properties: {
        parentId: { type: 'string', description: 'Filter by parent node id.' },
        top: { type: 'integer', minimum: 1, maximum: 200 },
        skip: { type: 'integer', minimum: 0 },
      },
    },
  },

  // ── Process Monitoring ────────────────────────────────────────────────────
  {
    name: 'calm_processes_list',
    description: 'List Cloud ALM monitored business processes.',
    inputSchema: {
      type: 'object',
      properties: {
        top: { type: 'integer', minimum: 1, maximum: 200 },
        skip: { type: 'integer', minimum: 0 },
      },
    },
  },

  // ── Analytics ─────────────────────────────────────────────────────────────
  {
    name: 'calm_analytics_query',
    description:
      'Query a Cloud ALM analytics endpoint. Provide the relative endpoint path (e.g. "kpis", "reports") and optional OData-style query params.',
    inputSchema: {
      type: 'object',
      required: ['endpoint'],
      properties: {
        endpoint: {
          type: 'string',
          description: "Relative path under /calm-analytics/v1/, e.g. 'kpis'.",
        },
        params: {
          type: 'object',
          description: 'Key-value query parameters.',
          additionalProperties: { type: 'string' },
        },
      },
    },
  },
];
