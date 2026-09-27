import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { ConfigError } from "./errors.js";
import type { AppConfig, InstanceConfig, PublicInstance, RawConfigYaml, RawInstanceYaml } from "./types.js";

const DEFAULT_WEBSERVICE_PATH = "/webservice.php";
const DEFAULT_TIMEOUT_MS = 30_000;

export function accessKeyEnvName(instanceId: string): string {
  return `VTIGER_${instanceId.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_ACCESS_KEY`;
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ConfigError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function asRequiredString(value: unknown, field: string): string {
  const result = asOptionalString(value, field);
  if (!result) {
    throw new ConfigError(`${field} is required`);
  }
  return result;
}

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function requireEnv(name: string, purpose: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new ConfigError(
      `Environment variable ${name} is missing or empty (${purpose}). Set it in .env or the MCP host env — do not put secrets in instances.yaml.`,
    );
  }
  return value;
}

function parseBaseUrl(raw: string, instanceId: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`instances.${instanceId}.base_url is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(`instances.${instanceId}.base_url must be http(s)`);
  }
  return raw.replace(/\/+$/, "");
}

function parseWebservicePath(raw: string | undefined): string {
  const path = raw ?? DEFAULT_WEBSERVICE_PATH;
  return path.startsWith("/") ? path : `/${path}`;
}

export function parseTimeoutMs(raw: string | undefined): number {
  if (!raw) {
    return DEFAULT_TIMEOUT_MS;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1000) {
    throw new ConfigError("VTIGER_HTTP_TIMEOUT_MS must be a number >= 1000");
  }
  return value;
}

export function isDeleteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.VTIGER_ENABLE_DELETE ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function resolveCloudflareAccess(
  raw: RawInstanceYaml,
  instanceId: string,
): Pick<InstanceConfig, "cfAccessClientId" | "cfAccessClientSecret"> {
  const idEnv = asOptionalString(raw.cf_access_client_id_env, `instances.${instanceId}.cf_access_client_id_env`);
  const secretEnv = asOptionalString(
    raw.cf_access_client_secret_env,
    `instances.${instanceId}.cf_access_client_secret_env`,
  );

  const clientId = idEnv ? readEnv(idEnv) : undefined;
  const clientSecret = secretEnv ? readEnv(secretEnv) : undefined;

  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new ConfigError(
      `Instance "${instanceId}" has only one of CF-Access-Client-Id / CF-Access-Client-Secret set. Provide both or neither.`,
    );
  }

  if (clientId && clientSecret) {
    return { cfAccessClientId: clientId, cfAccessClientSecret: clientSecret };
  }
  return {};
}

export function resolveInstance(raw: RawInstanceYaml, index: number): InstanceConfig {
  const id = asRequiredString(raw.id, `instances[${index}].id`);

  if (raw.access_key !== undefined && raw.access_key !== null && raw.access_key !== "") {
    throw new ConfigError(
      `instances.${id}.access_key is not allowed. Use access_key_env (e.g. ${accessKeyEnvName(id)}) and keep the secret in the environment.`,
    );
  }

  const accessKeyEnv =
    asOptionalString(raw.access_key_env, `instances.${id}.access_key_env`) ?? accessKeyEnvName(id);
  const usernameEnv = asOptionalString(raw.username_env, `instances.${id}.username_env`);
  const usernameLiteral = asOptionalString(raw.username, `instances.${id}.username`);

  if (!usernameEnv && !usernameLiteral) {
    throw new ConfigError(`Instance "${id}" needs username or username_env`);
  }

  const username = usernameEnv ? requireEnv(usernameEnv, `Vtiger username for "${id}"`) : usernameLiteral!;

  return {
    id,
    name: asOptionalString(raw.name, `instances.${id}.name`) ?? id,
    baseUrl: parseBaseUrl(asRequiredString(raw.base_url, `instances.${id}.base_url`), id),
    username,
    accessKey: requireEnv(accessKeyEnv, `Vtiger access key for "${id}"`),
    webservicePath: parseWebservicePath(asOptionalString(raw.webservice_path, `instances.${id}.webservice_path`)),
    ...resolveCloudflareAccess(raw, id),
  };
}

export function parseConfigDocument(
  document: RawConfigYaml,
  options: { instancesFile: string; env?: NodeJS.ProcessEnv } = { instancesFile: "instances.yaml" },
): AppConfig {
  if (!Array.isArray(document.instances) || document.instances.length === 0) {
    throw new ConfigError("instances.yaml must contain a non-empty instances list");
  }

  const instances = new Map<string, InstanceConfig>();
  document.instances.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new ConfigError(`instances[${index}] must be a mapping`);
    }
    const resolved = resolveInstance(entry as RawInstanceYaml, index);
    if (instances.has(resolved.id)) {
      throw new ConfigError(`Duplicate instance id "${resolved.id}"`);
    }
    instances.set(resolved.id, resolved);
  });

  const env = options.env ?? process.env;
  const fromEnv = (env.VTIGER_DEFAULT_INSTANCE ?? "").trim();
  const fromFile =
    typeof document.default_instance === "string" ? document.default_instance.trim() : "";
  const defaultInstance = fromEnv || fromFile || [...instances.keys()][0];

  if (!instances.has(defaultInstance)) {
    throw new ConfigError(
      `default_instance "${defaultInstance}" is not in instances.yaml (have: ${[...instances.keys()].join(", ")})`,
    );
  }

  return {
    defaultInstance,
    deleteEnabled: isDeleteEnabled(env),
    httpTimeoutMs: parseTimeoutMs(env.VTIGER_HTTP_TIMEOUT_MS),
    instancesFile: options.instancesFile,
    instances,
  };
}

export function loadConfigFromYaml(yamlText: string, instancesFile: string): AppConfig {
  let document: RawConfigYaml;
  try {
    document = (parseYaml(yamlText) ?? {}) as RawConfigYaml;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Failed to parse ${instancesFile}: ${message}`);
  }
  return parseConfigDocument(document, { instancesFile });
}

export function resolveInstancesFile(argv: string[] = process.argv.slice(2)): string {
  const flagIndex = argv.findIndex((arg) => arg === "--config" || arg === "--instances");
  if (flagIndex >= 0) {
    const value = argv[flagIndex + 1];
    if (!value || value.startsWith("-")) {
      throw new ConfigError("--config requires a path to instances.yaml");
    }
    return resolve(value);
  }

  const fromEnv = (process.env.VTIGER_INSTANCES_FILE ?? "").trim();
  if (fromEnv) {
    return resolve(fromEnv);
  }
  return resolve(process.cwd(), "instances.yaml");
}

export function loadConfig(argv: string[] = process.argv.slice(2)): AppConfig {
  const instancesFile = resolveInstancesFile(argv);
  let yamlText: string;
  try {
    yamlText = readFileSync(instancesFile, "utf8");
  } catch {
    throw new ConfigError(
      `Instance file not found: ${instancesFile}. Copy instances.example.yaml to instances.yaml and set VTIGER_INSTANCES_FILE.`,
    );
  }
  return loadConfigFromYaml(yamlText, instancesFile);
}

export function listPublicInstances(config: AppConfig): PublicInstance[] {
  return [...config.instances.values()].map((instance) => ({
    id: instance.id,
    name: instance.name,
    base_url: instance.baseUrl,
  }));
}

export function getInstance(config: AppConfig, instanceId?: string): InstanceConfig {
  const id = (instanceId ?? "").trim() || config.defaultInstance;
  const instance = config.instances.get(id);
  if (!instance) {
    throw new ConfigError(
      `Unknown instance "${id}". Known ids: ${[...config.instances.keys()].join(", ")}. Call vtiger_list_instances.`,
    );
  }
  return instance;
}
