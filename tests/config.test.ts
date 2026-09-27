import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  accessKeyEnvName,
  getInstance,
  listPublicInstances,
  loadConfigFromYaml,
  parseConfigDocument,
} from "../src/config.js";
import { ConfigError } from "../src/errors.js";
import { SAMPLE_YAML, sampleEnv } from "./fixtures.js";

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
});

function loadSample(env: NodeJS.ProcessEnv = sampleEnv()) {
  Object.assign(process.env, env);
  return loadConfigFromYaml(SAMPLE_YAML, "instances.yaml");
}

describe("accessKeyEnvName", () => {
  it("maps instance ids to VTIGER_<ID>_ACCESS_KEY", () => {
    expect(accessKeyEnvName("dragonsden")).toBe("VTIGER_DRAGONSDEN_ACCESS_KEY");
    expect(accessKeyEnvName("tec-yeah")).toBe("VTIGER_TEC_YEAH_ACCESS_KEY");
  });
});

describe("loadConfigFromYaml", () => {
  it("resolves two instances from env refs and hides secrets from the public list", () => {
    const config = loadSample();
    expect(config.defaultInstance).toBe("dragonsden");
    expect(config.instances.size).toBe(2);

    const dragons = config.instances.get("dragonsden")!;
    expect(dragons.baseUrl).toBe("https://crm.dragonsden.work");
    expect(dragons.username).toBe("webservice.user");
    expect(dragons.accessKey).toBe("dragonsden-access-key");
    expect(dragons.cfAccessClientId).toBe("cf-client-id");

    const publicList = listPublicInstances(config);
    expect(publicList).toEqual([
      { id: "dragonsden", name: "Dragons Den CRM", base_url: "https://crm.dragonsden.work" },
      { id: "tecyeah", name: "TecYeah CRM", base_url: "https://crm.example.com" },
    ]);
    expect(JSON.stringify(publicList)).not.toContain("access-key");
    expect(JSON.stringify(publicList)).not.toContain("cf-client");
  });

  it("lets VTIGER_DEFAULT_INSTANCE override the file default", () => {
    const config = loadSample(sampleEnv({ VTIGER_DEFAULT_INSTANCE: "tecyeah" }));
    expect(config.defaultInstance).toBe("tecyeah");
  });

  it("rejects inline access_key so secrets cannot live in yaml", () => {
    Object.assign(process.env, sampleEnv());
    expect(() =>
      parseConfigDocument(
        {
          instances: [
            {
              id: "dragonsden",
              base_url: "https://crm.dragonsden.work",
              username: "user",
              access_key: "leaked",
              access_key_env: "VTIGER_DRAGONSDEN_ACCESS_KEY",
            },
          ],
        },
        { instancesFile: "x.yaml" },
      ),
    ).toThrow(/access_key is not allowed/);
  });

  it("fails when the access key env is missing", () => {
    expect(() => loadSample(sampleEnv({ VTIGER_DRAGONSDEN_ACCESS_KEY: "" }))).toThrow(ConfigError);
  });

  it("fails when only one Cloudflare Access value is set", () => {
    expect(() =>
      loadSample(sampleEnv({ VTIGER_DRAGONSDEN_CF_ACCESS_CLIENT_SECRET: "" })),
    ).toThrow(/only one of CF-Access/);
  });

  it("allows instances without Cloudflare Access", () => {
    const config = loadSample(
      sampleEnv({
        VTIGER_DRAGONSDEN_CF_ACCESS_CLIENT_ID: "",
        VTIGER_DRAGONSDEN_CF_ACCESS_CLIENT_SECRET: "",
      }),
    );
    expect(config.instances.get("dragonsden")!.cfAccessClientId).toBeUndefined();
  });

  it("resolves a username literal when username_env is omitted", () => {
    Object.assign(process.env, sampleEnv());
    const config = parseConfigDocument(
      {
        instances: [
          {
            id: "solo",
            base_url: "https://crm.example.com",
            username: "literal.user",
            access_key_env: "VTIGER_TECYEAH_ACCESS_KEY",
          },
        ],
      },
      { instancesFile: "x.yaml" },
    );
    expect(config.instances.get("solo")!.username).toBe("literal.user");
  });
});

describe("getInstance", () => {
  it("uses the default when instance is omitted", () => {
    const config = loadSample();
    expect(getInstance(config).id).toBe("dragonsden");
    expect(getInstance(config, "tecyeah").id).toBe("tecyeah");
  });

  it("rejects unknown ids", () => {
    const config = loadSample();
    expect(() => getInstance(config, "missing")).toThrow(/Unknown instance/);
  });
});

describe("example files", () => {
  it("loads instances.example.yaml when matching env vars are set", async () => {
    const { readFileSync } = await import("node:fs");
    Object.assign(process.env, sampleEnv());
    const yaml = readFileSync(new URL("../instances.example.yaml", import.meta.url), "utf8");
    const config = loadConfigFromYaml(yaml, "instances.example.yaml");
    expect([...config.instances.keys()]).toEqual(["dragonsden", "tecyeah"]);
  });

  it("can write a temp instances.yaml and read it back", () => {
    Object.assign(process.env, sampleEnv());
    const dir = mkdtempSync(join(tmpdir(), "vtiger-mcp-"));
    const path = join(dir, "instances.yaml");
    writeFileSync(path, SAMPLE_YAML);
    const config = loadConfigFromYaml(SAMPLE_YAML, path);
    expect(config.instancesFile).toBe(path);
  });
});
