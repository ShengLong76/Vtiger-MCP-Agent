import type { AppConfig, InstanceConfig } from "../src/types.js";

export const SAMPLE_YAML = `
default_instance: dragonsden
instances:
  - id: dragonsden
    name: Dragons Den CRM
    base_url: https://crm.dragonsden.work
    username_env: VTIGER_DRAGONSDEN_USERNAME
    access_key_env: VTIGER_DRAGONSDEN_ACCESS_KEY
    cf_access_client_id_env: VTIGER_DRAGONSDEN_CF_ACCESS_CLIENT_ID
    cf_access_client_secret_env: VTIGER_DRAGONSDEN_CF_ACCESS_CLIENT_SECRET
  - id: tecyeah
    name: TecYeah CRM
    base_url: https://crm.example.com
    username_env: VTIGER_TECYEAH_USERNAME
    access_key_env: VTIGER_TECYEAH_ACCESS_KEY
`;

export function sampleEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    VTIGER_DRAGONSDEN_USERNAME: "webservice.user",
    VTIGER_DRAGONSDEN_ACCESS_KEY: "dragonsden-access-key",
    VTIGER_DRAGONSDEN_CF_ACCESS_CLIENT_ID: "cf-client-id",
    VTIGER_DRAGONSDEN_CF_ACCESS_CLIENT_SECRET: "cf-client-secret",
    VTIGER_TECYEAH_USERNAME: "tecyeah.user",
    VTIGER_TECYEAH_ACCESS_KEY: "tecyeah-access-key",
    VTIGER_ENABLE_DELETE: "false",
    ...overrides,
  };
}

export function instance(partial: Partial<InstanceConfig> & Pick<InstanceConfig, "id">): InstanceConfig {
  return {
    name: partial.name ?? partial.id,
    baseUrl: partial.baseUrl ?? "https://crm.example.com",
    username: partial.username ?? "user",
    accessKey: partial.accessKey ?? "key",
    webservicePath: partial.webservicePath ?? "/webservice.php",
    cfAccessClientId: partial.cfAccessClientId,
    cfAccessClientSecret: partial.cfAccessClientSecret,
    ...partial,
  };
}

export function appConfig(instances: InstanceConfig[], extra: Partial<AppConfig> = {}): AppConfig {
  const map = new Map(instances.map((item) => [item.id, item]));
  return {
    defaultInstance: extra.defaultInstance ?? instances[0]!.id,
    deleteEnabled: extra.deleteEnabled ?? false,
    httpTimeoutMs: extra.httpTimeoutMs ?? 30_000,
    instancesFile: extra.instancesFile ?? "/tmp/instances.yaml",
    instances: extra.instances ?? map,
  };
}
