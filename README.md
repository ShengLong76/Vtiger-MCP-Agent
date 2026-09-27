# Vtiger MCP Agent

Stdio [MCP](https://modelcontextprotocol.io) server for **Vtiger CRM 8.x** `/webservice.php`. Cos / Grok Bot can query and update any module the webservice user can reach, across **multiple named instances**, without browser automation.

Primary instance today: [https://crm.dragonsden.work](https://crm.dragonsden.work) (Vtiger 8.3, Cloudflare Access).

## What this is

- **All modules** — Contacts, Accounts, Leads, Potentials/Opportunities, Project, ProjectTask, HelpDesk, Calendar, Documents, and custom modules. Nothing is hardcoded to Projects.
- **N instances** — add `tecyeah` or a future client in `instances.yaml`. Cos passes `instance` on each tool call. No server fork.
- **Secrets in env** — access keys and Cloudflare Access Service Tokens are referenced by name (`VTIGER_<ID>_ACCESS_KEY`). They are never written to yaml or returned by tools.

Module coverage equals the ACL of the Vtiger user whose access key you configure. An admin key sees every module that user can; a restricted user is limited by CRM permissions.

## Tools

Every tool except `vtiger_list_instances` accepts optional `instance` (defaults to `default_instance` / `VTIGER_DEFAULT_INSTANCE`).

| Tool | Purpose |
| --- | --- |
| `vtiger_list_instances` | ids + base URLs (no secrets) |
| `vtiger_list_types` | modules the API user can access |
| `vtiger_describe` | field metadata for one module |
| `vtiger_query` | Vtiger Query Language; module unrestricted (ACL still applies) |
| `vtiger_retrieve` | record by webservice id (`12x115`) |
| `vtiger_create` | module + field map |
| `vtiger_update` | full-record update (mandatory fields required by Vtiger) |
| `vtiger_revise` | partial update |
| `vtiger_search` | LIKE helper (uses `labelFields` when `fields` omitted) |
| `vtiger_delete` | **destructive** — disabled unless `VTIGER_ENABLE_DELETE=true` and `confirm=true` |

## Requirements

- Node.js 20+
- A Vtiger 8.x site with `/webservice.php`
- Per instance: username + **Access Key** from CRM **My Preferences**
- If the site is behind Cloudflare Access: a **Service Token** (Client ID + Client Secret)

## Setup

```bash
git clone https://github.com/ShengLong76/Vtiger-MCP-Agent.git
cd Vtiger-MCP-Agent
npm install
cp instances.example.yaml instances.yaml
cp .env.example .env
# edit instances.yaml and .env with your values
npm run build
```

`instances.yaml` is gitignored. Keep real keys out of git.

### Configure the first instance

`instances.example.yaml` already lists `dragonsden` at `https://crm.dragonsden.work`. In `.env` (or the MCP host env):

```bash
VTIGER_DRAGONSDEN_USERNAME=<your Vtiger username>
VTIGER_DRAGONSDEN_ACCESS_KEY=<My Preferences → Access Key>
```

### Add a second instance

1. Copy a block in `instances.yaml`:

   ```yaml
   - id: tecyeah
     name: TecYeah CRM
     base_url: https://crm.example.com   # that client's real CRM URL
     username_env: VTIGER_TECYEAH_USERNAME
     access_key_env: VTIGER_TECYEAH_ACCESS_KEY
     cf_access_client_id_env: VTIGER_TECYEAH_CF_ACCESS_CLIENT_ID
     cf_access_client_secret_env: VTIGER_TECYEAH_CF_ACCESS_CLIENT_SECRET
   ```

2. Set `VTIGER_TECYEAH_USERNAME` and `VTIGER_TECYEAH_ACCESS_KEY` in the environment (same pattern: `VTIGER_<ID>_ACCESS_KEY`).
3. Restart the MCP server. Cos / Grok Bot can pass `"instance": "tecyeah"` on any tool. Omit it to use `default_instance`.

Repeat for more clients. `id` is the stable key Cos passes; keep it lowercase and URL-safe.

### Cloudflare Access Service Tokens

Dragons Den CRM sits behind Cloudflare Access. Interactive browser login does not work for Cos / Grok Bot. Create a **Service Token** and send it on every `/webservice.php` call.

1. Cloudflare Zero Trust → **Access** → **Service Auth** (Service Tokens) → create a token. Copy **Client ID** and **Client Secret** once.
2. On the Access application that protects the CRM hostname, add a **Service Auth** policy that **includes** that token.
3. Put the values in env (never in yaml):

   ```bash
   VTIGER_DRAGONSDEN_CF_ACCESS_CLIENT_ID=
   VTIGER_DRAGONSDEN_CF_ACCESS_CLIENT_SECRET=
   ```

4. This server sends them as:

   - `CF-Access-Client-Id`
   - `CF-Access-Client-Secret`

Official docs: [Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) and [Authenticate coding agents](https://developers.cloudflare.com/cloudflare-one/access-controls/authenticate-agents/).

If a tool returns `CLOUDFLARE_ACCESS` or HTML instead of JSON, the Service Token is missing, expired, or not allowed on that Access application.

If the Vtiger user has an **IP whitelist** under My Preferences, add the egress address of the host that runs this MCP process. Do not guess addresses.

### Auth flow (Vtiger)

1. `GET /webservice.php?operation=getchallenge&username=...`
2. `POST operation=login` with `accessKey = md5(challengeToken + userAccessKey)`
3. Later calls send `sessionName`. This server caches the session per instance and re-logins on `INVALID_SESSIONID`.

## Cos / Grok Bot install

After `npm run build`, point the MCP host at `dist/index.js`. Fill env from your own consoles — leave placeholders empty in committed samples.

Cursor / Cos / Claude-style JSON (`examples/cos-grok-bot-mcp.json`):

```json
{
  "mcpServers": {
    "vtiger": {
      "command": "node",
      "args": ["/absolute/path/to/Vtiger-MCP-Agent/dist/index.js"],
      "env": {
        "VTIGER_INSTANCES_FILE": "/absolute/path/to/Vtiger-MCP-Agent/instances.yaml",
        "VTIGER_DEFAULT_INSTANCE": "dragonsden",
        "VTIGER_ENABLE_DELETE": "false",
        "VTIGER_DRAGONSDEN_USERNAME": "",
        "VTIGER_DRAGONSDEN_ACCESS_KEY": "",
        "VTIGER_DRAGONSDEN_CF_ACCESS_CLIENT_ID": "",
        "VTIGER_DRAGONSDEN_CF_ACCESS_CLIENT_SECRET": "",
        "VTIGER_TECYEAH_USERNAME": "",
        "VTIGER_TECYEAH_ACCESS_KEY": ""
      }
    }
  }
}
```

Dev without a prior build: `"command": "npx"`, `"args": ["tsx", "/absolute/path/to/Vtiger-MCP-Agent/src/index.ts"]` (requires dependencies installed).

xAI Grok user config (`~/.grok/config.toml`) is in `examples/grok-config.toml`. Prefer `${VAR}` expansion so secrets stay in the shell environment.

Check config without opening an MCP session:

```bash
npx tsx src/index.ts --self-check
```

`--self-check` prints instance ids, base URLs, whether Cloudflare Access headers are configured, and the tool list. It does not print keys.

## Smoke tests (any module)

These are examples. Use `vtiger_list_types` / `vtiger_describe` on the live instance if names differ.

| Step | Tool | Example arguments |
| --- | --- | --- |
| 1 | `vtiger_list_instances` | (none) |
| 2 | `vtiger_list_types` | `{ "instance": "dragonsden" }` |
| 3 | `vtiger_describe` | `{ "module": "Contacts" }` |
| 4 | `vtiger_query` | `{ "query": "SELECT id, lastname FROM Contacts LIMIT 5;" }` |
| 5 | `vtiger_query` | `{ "query": "SELECT id, accountname FROM Accounts LIMIT 5;" }` |
| 6 | `vtiger_query` | `{ "query": "SELECT id, projectname FROM Project LIMIT 5;" }` |
| 7 | `vtiger_search` | `{ "module": "HelpDesk", "term": "login" }` |
| 8 | `vtiger_retrieve` | `{ "id": "<id from step 4>" }` |
| 9 | `vtiger_revise` | `{ "id": "<id>", "element": { "description": "updated via MCP" } }` |
| 10 | second CRM | repeat 2–4 with `"instance": "tecyeah"` |

Query language (no JOINs, no parentheses grouping):

```
SELECT * | column_list | COUNT(*)
FROM Module
[WHERE conditions AND/OR ...]
[ORDER BY columns]
[LIMIT n]
```

Webservice ids look like `12x115` (module prefix `x` crmid), not the integer crmid alone.

`vtiger_delete` is off by default. Enable only when you intend to destroy records:

```bash
VTIGER_ENABLE_DELETE=true
```

and pass `"confirm": true`.

## Development

```bash
npm install
npm test
npm run build
```

Unit tests cover yaml/env loading, challenge+login hashing, session retry, Cloudflare Access failure mapping, multi-instance routing, generic (not Projects-only) create, and delete gating. They do not call a live CRM and do not embed real credentials.

## Optional: n8n

Same webservice, same Access headers, no MCP. See [examples/n8n-vtiger-webservice.md](examples/n8n-vtiger-webservice.md).

## Configuration reference

| Env | Role |
| --- | --- |
| `VTIGER_INSTANCES_FILE` | Path to `instances.yaml` (or `--config`) |
| `VTIGER_DEFAULT_INSTANCE` | Default `instance` id |
| `VTIGER_HTTP_TIMEOUT_MS` | Per-request timeout (default `30000`) |
| `VTIGER_ENABLE_DELETE` | `true` / `1` / `yes` to allow `vtiger_delete` |
| `VTIGER_<ID>_USERNAME` | Typical `username_env` |
| `VTIGER_<ID>_ACCESS_KEY` | Required access key env |
| `VTIGER_<ID>_CF_ACCESS_CLIENT_ID` | Optional Access Service Token id |
| `VTIGER_<ID>_CF_ACCESS_CLIENT_SECRET` | Optional Access Service Token secret |

Inline `access_key` in yaml is rejected on purpose.
