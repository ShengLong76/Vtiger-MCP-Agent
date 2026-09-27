import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConfigError, VtigerApiError } from "./errors.js";
import {
  createRecord,
  deleteRecord,
  describeModule,
  listInstances,
  listTypes,
  queryRecords,
  retrieveRecord,
  reviseRecord,
  searchRecords,
  updateRecord,
  type ToolContext,
} from "./handlers.js";

const INSTANCE_DESC =
  "Named instance id from instances.yaml (e.g. dragonsden, tecyeah). Omit to use default_instance.";

const instanceField = z.string().optional().describe(INSTANCE_DESC);

const elementField = z
  .record(z.unknown())
  .describe("Field map for the Vtiger record. Use vtiger_describe to see module fields.");

function jsonText(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function asErrorResult(error: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  if (error instanceof ConfigError || error instanceof VtigerApiError) {
    const payload =
      error instanceof VtigerApiError
        ? { error: error.name, code: error.code, message: error.message, instance: error.instanceId }
        : { error: error.name, message: error.message };
    return { content: [{ type: "text", text: jsonText(payload) }], isError: true };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: jsonText({ error: "Error", message }) }], isError: true };
}

async function runTool(work: () => Promise<{ data: unknown }> | { data: unknown }) {
  try {
    const { data } = await work();
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  } catch (error) {
    return asErrorResult(error);
  }
}

export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({
    name: "vtiger-mcp-agent",
    version: "1.0.0",
  });

  server.registerTool(
    "vtiger_list_instances",
    {
      title: "List Vtiger instances",
      description:
        "List configured Vtiger instance ids and base URLs. Never returns secrets. Use the id as the optional `instance` argument on every other tool.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => runTool(() => listInstances(ctx)),
  );

  server.registerTool(
    "vtiger_list_types",
    {
      title: "List Vtiger modules",
      description:
        "List every Vtiger module the webservice user can access on an instance (Contacts, Accounts, Leads, Potentials, Project, ProjectTask, HelpDesk, Calendar, Documents, and any custom module allowed by that user's ACL). Coverage is the CRM user's permissions, not a hardcoded subset.",
      inputSchema: { instance: instanceField },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ instance }) => runTool(() => listTypes(ctx, { instance })),
  );

  server.registerTool(
    "vtiger_describe",
    {
      title: "Describe a Vtiger module",
      description:
        "Return field metadata for any module the webservice user can access (mandatory flags, types, label fields, idPrefix). Call this before create/update if field names are unknown.",
      inputSchema: {
        module: z
          .string()
          .describe("Vtiger module name, e.g. Contacts, Accounts, Leads, Potentials, Project, HelpDesk"),
        instance: instanceField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ module, instance }) => runTool(() => describeModule(ctx, { module, instance })),
  );

  server.registerTool(
    "vtiger_query",
    {
      title: "Query Vtiger",
      description:
        "Run Vtiger Query Language against any allowed module. Format: SELECT * | columns | COUNT(*) FROM Module WHERE ... ORDER BY ... LIMIT n; No JOINs, no parentheses grouping. Default result cap is 100 rows. Example: SELECT id, lastname FROM Contacts WHERE lastname LIKE '%Smith%' LIMIT 10;",
      inputSchema: {
        query: z.string().describe("Vtiger query language statement. A trailing semicolon is added if missing."),
        instance: instanceField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ query, instance }) => runTool(() => queryRecords(ctx, { query, instance })),
  );

  server.registerTool(
    "vtiger_retrieve",
    {
      title: "Retrieve a Vtiger record",
      description:
        "Retrieve one record by webservice id (moduleId x crmid, e.g. 12x115). Use vtiger_query if you only have a business key.",
      inputSchema: {
        id: z.string().describe("Webservice id, e.g. 12x115"),
        instance: instanceField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ id, instance }) => runTool(() => retrieveRecord(ctx, { id, instance })),
  );

  server.registerTool(
    "vtiger_create",
    {
      title: "Create a Vtiger record",
      description:
        "Create a record in any allowed module. `element` is a field map from vtiger_describe. Mandatory fields (often including assigned_user_id) must be present.",
      inputSchema: {
        module: z.string().describe("Vtiger module name"),
        element: elementField,
        instance: instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ module, element, instance }) => runTool(() => createRecord(ctx, { module, element, instance })),
  );

  server.registerTool(
    "vtiger_update",
    {
      title: "Update a Vtiger record",
      description:
        "Full-record update. Vtiger `update` requires mandatory fields. Prefer vtiger_revise for a partial patch. `id` is the webservice id.",
      inputSchema: {
        id: z.string().describe("Webservice id of the record to replace"),
        element: elementField,
        instance: instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ id, element, instance }) => runTool(() => updateRecord(ctx, { id, element, instance })),
  );

  server.registerTool(
    "vtiger_revise",
    {
      title: "Revise a Vtiger record",
      description: "Partial update (Vtiger `revise`). Only send fields you want to change plus the record id.",
      inputSchema: {
        id: z.string().describe("Webservice id of the record to patch"),
        element: elementField,
        instance: instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ id, element, instance }) => runTool(() => reviseRecord(ctx, { id, element, instance })),
  );

  server.registerTool(
    "vtiger_delete",
    {
      title: "Delete a Vtiger record",
      description:
        "DESTRUCTIVE: permanently delete a CRM record. Disabled unless VTIGER_ENABLE_DELETE=true. Also requires confirm=true on the call.",
      inputSchema: {
        id: z.string().describe("Webservice id to delete"),
        confirm: z
          .boolean()
          .describe("Must be true. Confirms you intend to permanently delete this record."),
        instance: instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ id, confirm, instance }) => runTool(() => deleteRecord(ctx, { id, confirm, instance })),
  );

  server.registerTool(
    "vtiger_search",
    {
      title: "Search a Vtiger module",
      description:
        "Convenience LIKE search on a module. If `fields` is omitted, uses the module's labelFields from describe. Subject to the same ACL as vtiger_query.",
      inputSchema: {
        module: z.string().describe("Vtiger module name"),
        term: z.string().describe("Substring to match (wrapped as LIKE %term%)"),
        fields: z
          .array(z.string())
          .optional()
          .describe("Fields to OR together. Defaults to the module labelFields."),
        limit: z.number().int().min(1).max(100).optional().describe("Max rows, default 20, cap 100"),
        instance: instanceField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ module, term, fields, limit, instance }) =>
      runTool(() => searchRecords(ctx, { module, term, fields, limit, instance })),
  );

  return server;
}
