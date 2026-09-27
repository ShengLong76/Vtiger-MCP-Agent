import { getInstance, listPublicInstances } from "./config.js";
import { ConfigError, VtigerApiError } from "./errors.js";
import type { AppConfig, JsonMap } from "./types.js";
import { VtigerClient, VtigerClientPool } from "./vtiger-client.js";

export interface ToolContext {
  config: AppConfig;
  pool: VtigerClientPool;
}

export interface ToolResult {
  data: unknown;
}

function wrap(client: VtigerClient, result: unknown): unknown {
  return {
    instance: client.instanceId,
    base_url: client.baseUrl,
    result,
  };
}

function clientFor(ctx: ToolContext, instanceId?: string): VtigerClient {
  const instance = getInstance(ctx.config, instanceId);
  return ctx.pool.get(instance);
}

export function listInstances(ctx: ToolContext): ToolResult {
  return {
    data: {
      default_instance: ctx.config.defaultInstance,
      delete_enabled: ctx.config.deleteEnabled,
      instances: listPublicInstances(ctx.config),
    },
  };
}

export async function listTypes(ctx: ToolContext, args: { instance?: string }): Promise<ToolResult> {
  const client = clientFor(ctx, args.instance);
  return { data: wrap(client, await client.listTypes()) };
}

export async function describeModule(
  ctx: ToolContext,
  args: { module: string; instance?: string },
): Promise<ToolResult> {
  const client = clientFor(ctx, args.instance);
  return { data: wrap(client, await client.describe(args.module)) };
}

export async function queryRecords(
  ctx: ToolContext,
  args: { query: string; instance?: string },
): Promise<ToolResult> {
  const client = clientFor(ctx, args.instance);
  return { data: wrap(client, await client.query(args.query)) };
}

export async function retrieveRecord(
  ctx: ToolContext,
  args: { id: string; instance?: string },
): Promise<ToolResult> {
  const client = clientFor(ctx, args.instance);
  return { data: wrap(client, await client.retrieve(args.id)) };
}

export async function createRecord(
  ctx: ToolContext,
  args: { module: string; element: JsonMap; instance?: string },
): Promise<ToolResult> {
  const client = clientFor(ctx, args.instance);
  return { data: wrap(client, await client.create(args.module, args.element)) };
}

export async function updateRecord(
  ctx: ToolContext,
  args: { id: string; element: JsonMap; instance?: string },
): Promise<ToolResult> {
  const client = clientFor(ctx, args.instance);
  return { data: wrap(client, await client.update({ ...args.element, id: args.id })) };
}

export async function reviseRecord(
  ctx: ToolContext,
  args: { id: string; element: JsonMap; instance?: string },
): Promise<ToolResult> {
  const client = clientFor(ctx, args.instance);
  return { data: wrap(client, await client.revise({ ...args.element, id: args.id })) };
}

export async function deleteRecord(
  ctx: ToolContext,
  args: { id: string; confirm?: boolean; instance?: string },
): Promise<ToolResult> {
  if (!ctx.config.deleteEnabled) {
    throw new ConfigError(
      "vtiger_delete is disabled. This operation is destructive. Set VTIGER_ENABLE_DELETE=true in the MCP host environment if you intend to allow deletes.",
    );
  }
  if (args.confirm !== true) {
    throw new ConfigError(
      "vtiger_delete requires confirm=true. This permanently deletes the CRM record.",
    );
  }
  const client = clientFor(ctx, args.instance);
  return { data: wrap(client, await client.delete(args.id)) };
}

function likeValue(term: string): string {
  return `'%${term.replace(/'/g, "''")}%'`;
}

export async function searchRecords(
  ctx: ToolContext,
  args: { module: string; term: string; fields?: string[]; limit?: number; instance?: string },
): Promise<ToolResult> {
  const client = clientFor(ctx, args.instance);
  const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 100) : 20;

  let fields = (args.fields ?? []).map((field) => field.trim()).filter(Boolean);
  if (fields.length === 0) {
    const meta = await client.describe(args.module);
    fields = (meta.labelFields ?? "")
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
  }
  if (fields.length === 0) {
    throw new VtigerApiError(
      "SEARCH_FIELDS",
      `Could not infer searchable fields for ${args.module}. Pass fields explicitly.`,
      { instanceId: client.instanceId },
    );
  }

  const where = fields.map((field) => `${field} LIKE ${likeValue(args.term)}`).join(" OR ");
  const query = `SELECT * FROM ${args.module} WHERE ${where} LIMIT ${limit};`;
  const result = await client.query(query);
  return {
    data: wrap(client, {
      query,
      fields,
      records: result,
    }),
  };
}

export const TOOL_NAMES = [
  "vtiger_list_instances",
  "vtiger_list_types",
  "vtiger_describe",
  "vtiger_query",
  "vtiger_retrieve",
  "vtiger_create",
  "vtiger_update",
  "vtiger_revise",
  "vtiger_delete",
  "vtiger_search",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
