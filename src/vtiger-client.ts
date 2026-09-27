import { isSessionError, VtigerApiError } from "./errors.js";
import { vtigerLoginAccessKey } from "./hash.js";
import type {
  ChallengeResult,
  DescribeResult,
  InstanceConfig,
  JsonMap,
  ListTypesResult,
  LoginResult,
  VtigerResponse,
} from "./types.js";

export type FetchLike = typeof fetch;

const SESSION_RETRY_CODES = new Set(["INVALID_SESSIONID", "AUTHENTICATIONREQUIRED", "AUTHREQUIRED"]);

function looksLikeHtml(body: string, contentType: string): boolean {
  return contentType.includes("text/html") || /^\s*<(!doctype|html|head|body)/i.test(body);
}

export class VtigerClient {
  private sessionName: string | null = null;
  private userId: string | null = null;

  constructor(
    private readonly instance: InstanceConfig,
    private readonly options: { fetch?: FetchLike; timeoutMs?: number } = {},
  ) {}

  get instanceId(): string {
    return this.instance.id;
  }

  get baseUrl(): string {
    return this.instance.baseUrl;
  }

  get webserviceUrl(): string {
    return `${this.instance.baseUrl}${this.instance.webservicePath}`;
  }

  get assignedUserId(): string | null {
    return this.userId;
  }

  cloudflareHeaders(): Record<string, string> {
    if (!this.instance.cfAccessClientId || !this.instance.cfAccessClientSecret) {
      return {};
    }
    return {
      "CF-Access-Client-Id": this.instance.cfAccessClientId,
      "CF-Access-Client-Secret": this.instance.cfAccessClientSecret,
    };
  }

  clearSession(): void {
    this.sessionName = null;
    this.userId = null;
  }

  async listTypes(): Promise<ListTypesResult> {
    return this.authed("listtypes", {}, "GET");
  }

  async describe(moduleName: string): Promise<DescribeResult> {
    return this.authed("describe", { elementType: moduleName }, "GET");
  }

  async query(query: string): Promise<JsonMap[]> {
    const normalized = normalizeQuery(query);
    return this.authed("query", { query: normalized }, "GET");
  }

  async retrieve(id: string): Promise<JsonMap> {
    return this.authed("retrieve", { id }, "GET");
  }

  async create(moduleName: string, element: JsonMap): Promise<JsonMap> {
    return this.authed(
      "create",
      { elementType: moduleName, element: JSON.stringify(element) },
      "POST",
    );
  }

  async update(element: JsonMap): Promise<JsonMap> {
    return this.authed("update", { element: JSON.stringify(element) }, "POST");
  }

  async revise(element: JsonMap): Promise<JsonMap> {
    return this.authed("revise", { element: JSON.stringify(element) }, "POST");
  }

  async delete(id: string): Promise<JsonMap> {
    return this.authed("delete", { id }, "POST");
  }

  private async authed<T>(
    operation: string,
    params: Record<string, string>,
    method: "GET" | "POST",
  ): Promise<T> {
    try {
      return await this.request<T>(operation, { ...params, sessionName: await this.ensureSession() }, method);
    } catch (error) {
      if (isSessionError(error)) {
        this.clearSession();
        return this.request<T>(operation, { ...params, sessionName: await this.ensureSession() }, method);
      }
      throw error;
    }
  }

  async ensureSession(): Promise<string> {
    if (this.sessionName) {
      return this.sessionName;
    }
    await this.login();
    if (!this.sessionName) {
      throw new VtigerApiError("LOGIN_FAILED", "Login succeeded but no sessionName was returned", {
        instanceId: this.instance.id,
      });
    }
    return this.sessionName;
  }

  async login(): Promise<LoginResult> {
    const challenge = await this.request<ChallengeResult>(
      "getchallenge",
      { username: this.instance.username },
      "GET",
    );
    if (!challenge.token) {
      throw new VtigerApiError("CHALLENGE_FAILED", "getchallenge returned no token", {
        instanceId: this.instance.id,
      });
    }
    const result = await this.request<LoginResult>(
      "login",
      {
        username: this.instance.username,
        accessKey: vtigerLoginAccessKey(challenge.token, this.instance.accessKey),
      },
      "POST",
    );
    this.sessionName = result.sessionName;
    this.userId = result.userId;
    return result;
  }

  async request<T>(
    operation: string,
    params: Record<string, string>,
    method: "GET" | "POST",
  ): Promise<T> {
    const fetchFn = this.options.fetch ?? fetch;
    const timeoutMs = this.options.timeoutMs ?? 30_000;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...this.cloudflareHeaders(),
    };

    const url = new URL(this.webserviceUrl);
    let body: string | undefined;

    if (method === "GET") {
      url.searchParams.set("operation", operation);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    } else {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      const form = new URLSearchParams();
      form.set("operation", operation);
      for (const [key, value] of Object.entries(params)) {
        form.set(key, value);
      }
      body = form.toString();
    }

    let response: Response;
    try {
      response = await fetchFn(url, {
        method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new VtigerApiError("NETWORK_ERROR", `Failed to reach ${this.webserviceUrl}: ${message}`, {
        instanceId: this.instance.id,
      });
    }

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();

    if (response.status === 302 || response.status === 401 || response.status === 403) {
      throw new VtigerApiError(
        "CLOUDFLARE_ACCESS",
        `HTTP ${response.status} from ${this.instance.baseUrl}. If this CRM is behind Cloudflare Access, set both CF-Access-Client-Id and CF-Access-Client-Secret env refs for instance "${this.instance.id}".`,
        { instanceId: this.instance.id, httpStatus: response.status },
      );
    }

    if (looksLikeHtml(text, contentType)) {
      throw new VtigerApiError(
        "CLOUDFLARE_ACCESS",
        `Received HTML instead of JSON from ${this.webserviceUrl} (HTTP ${response.status}). This usually means Cloudflare Access blocked the request. Configure a Service Token for instance "${this.instance.id}".`,
        { instanceId: this.instance.id, httpStatus: response.status },
      );
    }

    if (!response.ok) {
      throw new VtigerApiError(
        "HTTP_ERROR",
        `HTTP ${response.status} from ${this.webserviceUrl}: ${text.slice(0, 400)}`,
        { instanceId: this.instance.id, httpStatus: response.status },
      );
    }

    let parsed: VtigerResponse<T>;
    try {
      parsed = JSON.parse(text) as VtigerResponse<T>;
    } catch {
      throw new VtigerApiError(
        "INVALID_JSON",
        `Vtiger returned non-JSON from ${operation}: ${text.slice(0, 400)}`,
        { instanceId: this.instance.id },
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw new VtigerApiError("INVALID_JSON", `Unexpected Vtiger payload for ${operation}`, {
        instanceId: this.instance.id,
      });
    }

    if (parsed.success) {
      return parsed.result;
    }

    const code = parsed.error?.code ?? "VTIGER_ERROR";
    const message = parsed.error?.message ?? `Vtiger ${operation} failed`;
    if (SESSION_RETRY_CODES.has(code)) {
      throw new VtigerApiError(code, message, { instanceId: this.instance.id });
    }
    throw new VtigerApiError(code, message, { instanceId: this.instance.id });
  }
}

export function normalizeQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new VtigerApiError("INVALID_QUERY", "query must not be empty");
  }
  return /;\s*$/.test(trimmed) ? trimmed : `${trimmed};`;
}

export class VtigerClientPool {
  private readonly clients = new Map<string, VtigerClient>();

  constructor(
    private readonly instances: Map<string, InstanceConfig>,
    private readonly options: { fetch?: FetchLike; timeoutMs?: number } = {},
  ) {}

  get(instance: InstanceConfig): VtigerClient {
    const existing = this.clients.get(instance.id);
    if (existing) {
      return existing;
    }
    const client = new VtigerClient(instance, this.options);
    this.clients.set(instance.id, client);
    return client;
  }
}
