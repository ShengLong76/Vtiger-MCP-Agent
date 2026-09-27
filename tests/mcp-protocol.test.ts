import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "../src/handlers.js";
import { createMcpServer } from "../src/server.js";
import { VtigerClientPool } from "../src/vtiger-client.js";
import { appConfig, instance } from "./fixtures.js";

describe("MCP protocol", () => {
  it("advertises generic tools and list_instances without secrets", async () => {
    const config = appConfig([
      instance({
        id: "dragonsden",
        name: "Dragons Den CRM",
        baseUrl: "https://crm.dragonsden.work",
        accessKey: "should-never-appear",
      }),
    ]);
    const server = createMcpServer({
      config,
      pool: new VtigerClientPool(config.instances),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    expect(names).toEqual([...TOOL_NAMES]);

    for (const tool of listed.tools) {
      if (tool.name !== "vtiger_list_instances") {
        expect(JSON.stringify(tool.inputSchema)).toContain("instance");
      }
    }

    const deleted = listed.tools.find((tool) => tool.name === "vtiger_delete");
    expect(deleted?.annotations?.destructiveHint).toBe(true);

    const result = await client.callTool({ name: "vtiger_list_instances", arguments: {} });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("dragonsden");
    expect(text).toContain("https://crm.dragonsden.work");
    expect(text).not.toContain("should-never-appear");

    await client.close();
    await server.close();
  });
});
