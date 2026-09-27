import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { vtigerLoginAccessKey } from "../src/hash.js";
import { normalizeQuery, VtigerClient } from "../src/vtiger-client.js";
import { instance } from "./fixtures.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("vtigerLoginAccessKey", () => {
  it("is md5(challengeToken + userAccessKey)", () => {
    const expected = createHash("md5").update("tokensecret", "utf8").digest("hex");
    expect(vtigerLoginAccessKey("token", "secret")).toBe(expected);
  });
});

describe("normalizeQuery", () => {
  it("appends a semicolon when missing", () => {
    expect(normalizeQuery("SELECT * FROM Contacts LIMIT 5")).toBe("SELECT * FROM Contacts LIMIT 5;");
    expect(normalizeQuery("SELECT * FROM Project;")).toBe("SELECT * FROM Project;");
  });
});

describe("VtigerClient", () => {
  it("challenge/login then GET query with session, attaching Access headers", async () => {
    const calls: { url: string; method: string; headers: Headers; body: string | undefined }[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      calls.push({
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: init?.body ? String(init.body) : undefined,
      });
      const url = new URL(request.url);
      const operation = url.searchParams.get("operation") ?? new URLSearchParams(String(init?.body ?? "")).get("operation");
      if (operation === "getchallenge") {
        return jsonResponse({ success: true, result: { token: "tok", serverTime: 1, expireTime: 2 } });
      }
      if (operation === "login") {
        return jsonResponse({
          success: true,
          result: { sessionName: "sess-1", userId: "19x1", version: "0.22", vtigerVersion: "8.3.0" },
        });
      }
      if (operation === "query") {
        return jsonResponse({ success: true, result: [{ id: "12x1", lastname: "Smith" }] });
      }
      return jsonResponse({ success: false, error: { code: "UNKNOWN", message: operation } }, { status: 200 });
    };

    const client = new VtigerClient(
      instance({
        id: "dragonsden",
        baseUrl: "https://crm.dragonsden.work",
        username: "webservice.user",
        accessKey: "secret",
        cfAccessClientId: "cf-id",
        cfAccessClientSecret: "cf-secret",
      }),
      { fetch: fetchMock },
    );

    const rows = await client.query("SELECT * FROM Contacts LIMIT 1");
    expect(rows).toEqual([{ id: "12x1", lastname: "Smith" }]);
    expect(calls).toHaveLength(3);

    expect(calls[0]!.url).toContain("operation=getchallenge");
    expect(calls[0]!.headers.get("CF-Access-Client-Id")).toBe("cf-id");
    expect(calls[0]!.headers.get("CF-Access-Client-Secret")).toBe("cf-secret");

    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.body).toContain("operation=login");
    expect(calls[1]!.body).toContain(`accessKey=${vtigerLoginAccessKey("tok", "secret")}`);

    expect(calls[2]!.url).toContain("sessionName=sess-1");
    expect(calls[2]!.url).toContain("FROM+Contacts");
  });

  it("re-logins once after INVALID_SESSIONID", async () => {
    let queryAttempts = 0;
    const fetchMock: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const operation =
        url.searchParams.get("operation") ?? new URLSearchParams(String(init?.body ?? "")).get("operation");
      if (operation === "getchallenge") {
        return jsonResponse({ success: true, result: { token: "tok" } });
      }
      if (operation === "login") {
        return jsonResponse({
          success: true,
          result: { sessionName: `sess-${queryAttempts}`, userId: "19x1", version: "0.22", vtigerVersion: "8.3.0" },
        });
      }
      if (operation === "query") {
        queryAttempts += 1;
        if (queryAttempts === 1) {
          return jsonResponse({ success: false, error: { code: "INVALID_SESSIONID", message: "expired" } });
        }
        return jsonResponse({ success: true, result: [] });
      }
      throw new Error(operation ?? "missing");
    };

    const client = new VtigerClient(instance({ id: "dragonsden" }), { fetch: fetchMock });
    await expect(client.query("SELECT * FROM Accounts")).resolves.toEqual([]);
    expect(queryAttempts).toBe(2);
  });

  it("maps HTML / 302 responses to a Cloudflare Access error", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response("<html>login</html>", {
        status: 302,
        headers: { location: "https://access.example.com", "content-type": "text/html" },
      });
    const client = new VtigerClient(instance({ id: "dragonsden" }), { fetch: fetchMock });
    await expect(client.listTypes()).rejects.toMatchObject({ code: "CLOUDFLARE_ACCESS" });
  });

  it("surfaces Vtiger error codes", async () => {
    const fetchMock: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const operation =
        url.searchParams.get("operation") ?? new URLSearchParams(String(init?.body ?? "")).get("operation");
      if (operation === "getchallenge") {
        return jsonResponse({ success: true, result: { token: "tok" } });
      }
      if (operation === "login") {
        return jsonResponse({
          success: true,
          result: { sessionName: "s", userId: "19x1", version: "0.22", vtigerVersion: "8.3.0" },
        });
      }
      return jsonResponse({
        success: false,
        error: { code: "ACCESS_DENIED", message: "Permission to perform the operation is denied" },
      });
    };
    const client = new VtigerClient(instance({ id: "dragonsden" }), { fetch: fetchMock });
    await expect(client.describe("Contacts")).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });

  it("POSTs create/update/revise/delete with JSON element payloads", async () => {
    const operations: string[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const params = url.searchParams.get("operation")
        ? url.searchParams
        : new URLSearchParams(String(init?.body ?? ""));
      const operation = params.get("operation") ?? "";
      operations.push(operation);
      if (operation === "getchallenge") {
        return jsonResponse({ success: true, result: { token: "tok" } });
      }
      if (operation === "login") {
        return jsonResponse({
          success: true,
          result: { sessionName: "s", userId: "19x1", version: "0.22", vtigerVersion: "8.3.0" },
        });
      }
      if (operation === "create") {
        expect(params.get("elementType")).toBe("Project");
        expect(JSON.parse(params.get("element")!)).toEqual({ projectname: "Alpha" });
        return jsonResponse({ success: true, result: { id: "31x9", projectname: "Alpha" } });
      }
      if (operation === "update" || operation === "revise") {
        expect(JSON.parse(params.get("element")!).id).toBe("31x9");
        return jsonResponse({ success: true, result: { id: "31x9" } });
      }
      if (operation === "delete") {
        expect(params.get("id")).toBe("31x9");
        return jsonResponse({ success: true, result: { status: "successful" } });
      }
      if (operation === "retrieve") {
        return jsonResponse({ success: true, result: { id: "31x9" } });
      }
      throw new Error(operation);
    };

    const client = new VtigerClient(instance({ id: "dragonsden" }), { fetch: fetchMock });
    await client.create("Project", { projectname: "Alpha" });
    await client.update({ id: "31x9", projectname: "Beta" });
    await client.revise({ id: "31x9", projectname: "Gamma" });
    await client.retrieve("31x9");
    await client.delete("31x9");
    expect(operations.filter((op) => ["create", "update", "revise", "retrieve", "delete"].includes(op))).toEqual([
      "create",
      "update",
      "revise",
      "retrieve",
      "delete",
    ]);
  });
});
