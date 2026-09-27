export interface RawInstanceYaml {
  id?: unknown;
  name?: unknown;
  base_url?: unknown;
  username?: unknown;
  username_env?: unknown;
  access_key?: unknown;
  access_key_env?: unknown;
  cf_access_client_id_env?: unknown;
  cf_access_client_secret_env?: unknown;
  webservice_path?: unknown;
}

export interface RawConfigYaml {
  default_instance?: unknown;
  instances?: unknown;
}

export interface InstanceConfig {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  accessKey: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
  webservicePath: string;
}

export interface AppConfig {
  defaultInstance: string;
  deleteEnabled: boolean;
  httpTimeoutMs: number;
  instancesFile: string;
  instances: Map<string, InstanceConfig>;
}

export interface PublicInstance {
  id: string;
  name: string;
  base_url: string;
}

export interface VtigerSuccess<T> {
  success: true;
  result: T;
}

export interface VtigerFailure {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export type VtigerResponse<T> = VtigerSuccess<T> | VtigerFailure;

export interface ChallengeResult {
  token: string;
  serverTime: number;
  expireTime: number;
}

export interface LoginResult {
  sessionName: string;
  userId: string;
  version: string;
  vtigerVersion: string;
}

export interface ListTypesResult {
  types: string[];
  information?: Record<string, { isEntity: boolean; label: string; singular?: string }>;
}

export interface DescribeField {
  name: string;
  label?: string;
  mandatory?: boolean;
  type?: { name: string; [key: string]: unknown };
  editable?: boolean;
  nullable?: boolean;
  default?: unknown;
}

export interface DescribeResult {
  label?: string;
  name?: string;
  createable?: boolean;
  updateable?: boolean;
  deleteable?: boolean;
  retrieveable?: boolean;
  labelFields?: string;
  fields?: DescribeField[];
  idPrefix?: string;
  [key: string]: unknown;
}

export type JsonMap = Record<string, unknown>;
