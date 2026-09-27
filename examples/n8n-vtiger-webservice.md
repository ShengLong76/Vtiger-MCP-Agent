# Appendix: n8n and the same Vtiger webservice

n8n is optional. The MCP server is the primary Cos / Grok Bot path. Workflows that cannot speak MCP can call the same Vtiger 8.x `/webservice.php` with the same credentials and Cloudflare Access headers.

Do not store access keys or Access Service Token secrets in workflow JSON that you commit.

## 1. Challenge

HTTP Request node, **GET**:

`{{ $env.VTIGER_BASE_URL }}/webservice.php?operation=getchallenge&username={{ $env.VTIGER_USERNAME }}`

Headers (only if the CRM is behind Cloudflare Access):

| Header | Value |
| --- | --- |
| `CF-Access-Client-Id` | `{{ $env.VTIGER_CF_ACCESS_CLIENT_ID }}` |
| `CF-Access-Client-Secret` | `{{ $env.VTIGER_CF_ACCESS_CLIENT_SECRET }}` |

Expression for the token: `{{ $json.result.token }}`

## 2. Login

HTTP Request node, **POST** `application/x-www-form-urlencoded` to `{{ $env.VTIGER_BASE_URL }}/webservice.php`

| Field | Value |
| --- | --- |
| `operation` | `login` |
| `username` | `{{ $env.VTIGER_USERNAME }}` |
| `accessKey` | MD5 of challenge token + user access key |

Compute the login hash in a Code node:

```javascript
const crypto = require("crypto");
const token = $("Challenge").first().json.result.token;
const accessKey = crypto
  .createHash("md5")
  .update(token + $env.VTIGER_ACCESS_KEY)
  .digest("hex");
return [{ json: { accessKey } }];
```

Session name: `{{ $json.result.sessionName }}`

## 3. Any module

Reuse the session on later HTTP Request nodes. Examples (replace the module name as needed):

- List modules: `GET ...?operation=listtypes&sessionName=...`
- Fields: `GET ...?operation=describe&sessionName=...&elementType=Contacts`
- Query: `GET ...?operation=query&sessionName=...&query=SELECT%20*%20FROM%20Project%20LIMIT%2010%3B`
- Retrieve: `GET ...?operation=retrieve&sessionName=...&id=12x115`
- Create: `POST` `operation=create`, `elementType=HelpDesk`, `element=<json>`
- Partial update: `POST` `operation=revise`, `element=<json including id>`
- Delete: `POST` `operation=delete`, `id=...` (destructive; keep this off unless the workflow is meant to delete)

Attach the same Access headers on every call if Access is enabled.

## 4. Multiple instances

Use a separate n8n credential set (or env prefix) per CRM, matching `instances.yaml` ids such as `dragonsden` and `tecyeah`. Do not share session names across instances.

## 5. Module coverage

Same rule as the MCP: n8n can only see modules the Vtiger user behind `VTIGER_ACCESS_KEY` is allowed to use.
