#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { ConfigError } from "./errors.js";
import { TOOL_NAMES } from "./handlers.js";
import { createMcpServer } from "./server.js";
import { VtigerClientPool } from "./vtiger-client.js";

loadDotenv();

function wantsSelfCheck(argv: string[]): boolean {
  return argv.includes("--self-check");
}

function printSelfCheck(): void {
  const config = loadConfig();
  const instances = [...config.instances.values()].map((instance) => ({
    id: instance.id,
    name: instance.name,
    base_url: instance.baseUrl,
    username: instance.username,
    cloudflare_access: Boolean(instance.cfAccessClientId && instance.cfAccessClientSecret),
  }));

  const report = {
    ok: true,
    instances_file: config.instancesFile,
    default_instance: config.defaultInstance,
    delete_enabled: config.deleteEnabled,
    http_timeout_ms: config.httpTimeoutMs,
    tools: [...TOOL_NAMES],
    instances,
  };

  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (wantsSelfCheck(argv)) {
    printSelfCheck();
    return;
  }

  const config = loadConfig(argv);
  const pool = new VtigerClientPool(config.instances, { timeoutMs: config.httpTimeoutMs });
  const server = createMcpServer({ config, pool });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof ConfigError || error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
