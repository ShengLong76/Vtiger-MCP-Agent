import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/errors.js";
import {
  createRecord,
  deleteRecord,
  describeModule,
  listInstances,
  queryRecords,
  searchRecords,
  TOOL_NAMES,
} from "../src/handlers.js";
import { VtigerClientPool } from "../src/vtiger-client.js";
import { appConfig, instance } from "./fixtures.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockVtiger(handlers: Record<string, (params: URLSearchParams) => unknown>): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const params = url.searchParams.get("operation")
      ? url.searchParams
      : new URLSearchParams(String(init?.body ?? ""));
    const operation = params.get("operation") ?? "";
    if (operation === "getchallenge") {
      return jsonResponse({ success: true, result: { token: "tok" } });
    }
    if (operation === "login") {
      return jsonResponse({
        success: true,
        result: { sessionName: "s", userId: "19x1", version: "0.22", vtigerVersion: "8.3.0" },
      });
    }
    const handler = handlers[operation];
    if (!handler) {
      return jsonResponse({ success: false, error: { code: "UNKNOWN", message: operation } });
    }
    return jsonResponse({ success: true, result: handler(params) });
  };
}

describe("handlers", () => {
  it("lists instances without secrets", () => {
    const config = appConfig([
      instance({
        id: "dragonsden",
        baseUrl: "https://crm.dragonsden.work",
        accessKey: "secret",
        cfAccessClientId: "id",
        cfAccessClientSecret: "secret",
      }),
      instance({ id: "tecyeah", baseUrl: "https://crm.example.com", accessKey: "other" }),
    ]);
    const result = listInstances({ config, pool: new VtigerClientPool(config.instances) });
    expect(result.data).toEqual({
      default_instance: "dragonsden",
      delete_enabled: false,
      instances: [
        { id: "dragonsden", name: "dragonsden", base_url: "https://crm.dragonsden.work" },
        { id: "tecyeah", name: "tecyeah", base_url: "https://crm.example.com" },
      ],
    });
    expect(JSON.stringify(result.data)).not.toContain("secret");
  });

  it("routes query to the requested instance", async () => {
    const seen: string[] = [];
    const fetchMock = mockVtiger({
      query: (params) => {
        seen.push(params.get("query") ?? "");
        return [{ id: "12x1" }];
      },
    });
    const config = appConfig([
      instance({ id: "dragonsden", baseUrl: "https://crm.dragonsden.work" }),
      instance({ id: "tecyeah", baseUrl: "https://crm.example.com" }),
    ]);
    const ctx = { config, pool: new VtigerClientPool(config.instances, { fetch: fetchMock }) };
    const result = await queryRecords(ctx, {
      query: "SELECT * FROM HelpDesk LIMIT 1",
      instance: "tecyeah",
    });
    expect(result.data).toMatchObject({
      instance: "tecyeah",
      base_url: "https://crm.example.com",
      result: [{ id: "12x1" }],
    });
    expect(seen[0]).toContain("HelpDesk");
  });

  it("creates in an arbitrary module name (not a Projects-only subset)", async () => {
    const created: string[] = [];
    const fetchMock = mockVtiger({
      create: (params) => {
        created.push(params.get("elementType") ?? "");
        return { id: "4x1" };
      },
    });
    const config = appConfig([instance({ id: "dragonsden" })]);
    const ctx = { config, pool: new VtigerClientPool(config.instances, { fetch: fetchMock }) };
    for (const moduleName of ["Contacts", "Accounts", "CustomTickets", "Project"]) {
      await createRecord(ctx, { module: moduleName, element: { lastname: "X" } });
    }
    expect(created).toEqual(["Contacts", "Accounts", "CustomTickets", "Project"]);
  });

  it("gates delete until env + confirm are set", async () => {
    const fetchMock = mockVtiger({
      delete: () => ({ status: "successful" }),
    });
    const disabled = appConfig([instance({ id: "dragonsden" })], { deleteEnabled: false });
    await expect(
      deleteRecord({ config: disabled, pool: new VtigerClientPool(disabled.instances, { fetch: fetchMock }) }, {
        id: "12x1",
        confirm: true,
      }),
    ).rejects.toBeInstanceOf(ConfigError);

    const enabled = appConfig([instance({ id: "dragonsden" })], { deleteEnabled: true });
    const ctx = { config: enabled, pool: new VtigerClientPool(enabled.instances, { fetch: fetchMock }) };
    await expect(deleteRecord(ctx, { id: "12x1", confirm: false })).rejects.toThrow(/confirm=true/);
    const deleted = await deleteRecord(ctx, { id: "12x1", confirm: true });
    expect(deleted.data).toMatchObject({ result: { status: "successful" } });
  });

  it("builds a LIKE query from describe labelFields", async () => {
    const fetchMock = mockVtiger({
      describe: () => ({ labelFields: "lastname,firstname", name: "Contacts" }),
      query: (params) => [{ query: params.get("query") }],
    });
    const config = appConfig([instance({ id: "dragonsden" })]);
    const ctx = { config, pool: new VtigerClientPool(config.instances, { fetch: fetchMock }) };
    const result = await searchRecords(ctx, { module: "Contacts", term: "Ada" });
    const payload = result.data as { result: { query: string; fields: string[] } };
    expect(payload.result.fields).toEqual(["lastname", "firstname"]);
    expect(payload.result.query).toBe("SELECT * FROM Contacts WHERE lastname LIKE '%Ada%' OR firstname LIKE '%Ada%' LIMIT 20;");
  });

  it("describes any module the caller names", async () => {
    const fetchMock = mockVtiger({
      describe: (params) => ({ name: params.get("elementType"), fields: [] }),
    });
    const config = appConfig([instance({ id: "dragonsden" })]);
    const ctx = { config, pool: new VtigerClientPool(config.instances, { fetch: fetchMock }) };
    const result = await describeModule(ctx, { module: "ProjectTask" });
    expect(result.data).toMatchObject({ result: { name: "ProjectTask" } });
  });

  it("exports the generic tool set", () => {
    expect(TOOL_NAMES).toEqual([
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
    ]);
  });
});
