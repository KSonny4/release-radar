const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const bootstrapToken = process.env.CLOUDFLARE_API_TOKEN;

if (!accountId || !zoneId || !bootstrapToken) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN are required");
}

const apiBase = "https://api.cloudflare.com/client/v4";
const phase = "http_request_firewall_custom";
const ruleDescription = "Release Radar Google Calendar importer bypass";
const ruleExpression = '(http.host eq "radar.pkubelka.cz" and (http.request.uri.path eq "/calendar/series.ics" or http.request.uri.path eq "/calendar/movies.ics") and http.user_agent eq "Google-Calendar-Importer")';

async function requestWith(token, path, init = {}, acceptedStatuses = []) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if ((!response.ok && !acceptedStatuses.includes(response.status)) || data.success === false) {
    const errors = Array.isArray(data.errors) && data.errors.length
      ? data.errors.map((e) => `${e.code ?? "?"}: ${e.message ?? e.error ?? "Cloudflare API error"}`).join("; ")
      : `HTTP ${response.status}`;
    const error = new Error(`${path}: ${errors}`);
    error.status = response.status;
    error.cloudflareErrors = data.errors;
    throw error;
  }
  return { status: response.status, result: data.result };
}

const bootstrapRequest = async (path, init = {}) => (await requestWith(bootstrapToken, path, init)).result;

async function createEphemeralWafToken() {
  const groups = await bootstrapRequest(`/accounts/${accountId}/tokens/permission_groups`);
  const wafGroup = groups.find((group) =>
    (group.name === "Zone WAF Write" || group.name === "Zone WAF Edit") &&
    Array.isArray(group.scopes) && group.scopes.includes("com.cloudflare.api.account.zone")
  );
  if (!wafGroup) {
    const candidates = groups
      .filter((group) => String(group.name || "").includes("WAF"))
      .map((group) => ({ name: group.name, scopes: group.scopes }));
    throw new Error(`Could not find zone-scoped WAF write permission group. Candidates: ${JSON.stringify(candidates)}`);
  }

  const expiresOn = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const created = await bootstrapRequest(`/accounts/${accountId}/tokens`, {
    method: "POST",
    body: JSON.stringify({
      name: `release-radar-calendar-waf-${Date.now()}`,
      policies: [{
        effect: "allow",
        resources: { [`com.cloudflare.api.account.zone.${zoneId}`]: "*" },
        permission_groups: [{ id: wafGroup.id }],
      }],
      expires_on: expiresOn,
    }),
  });

  if (!created?.id || !created?.value) throw new Error("Cloudflare created a WAF token without returning its id/value");
  console.log(`Created ephemeral zone-WAF token ${created.id}; expires ${expiresOn}`);
  return { id: created.id, value: created.value };
}

async function deleteEphemeralToken(id) {
  await bootstrapRequest(`/accounts/${accountId}/tokens/${id}`, { method: "DELETE" });
  console.log(`Revoked ephemeral zone-WAF token ${id}`);
}

const desiredRule = {
  description: ruleDescription,
  expression: ruleExpression,
  action: "skip",
  action_parameters: {
    ruleset: "current",
    phases: [
      "http_ratelimit",
      "http_request_sbfm",
      "http_request_firewall_managed",
    ],
    products: [
      "zoneLockdown",
      "uaBlock",
      "bic",
      "securityLevel",
    ],
  },
  logging: { enabled: true },
  enabled: true,
};

let ephemeral;
try {
  ephemeral = await createEphemeralWafToken();
  const wafRequest = (path, init = {}, acceptedStatuses = []) => requestWith(ephemeral.value, path, init, acceptedStatuses);
  const entryPath = `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`;
  const entry = await wafRequest(entryPath, {}, [404]);

  let ruleset;
  if (entry.status === 404) {
    console.log("No zone custom-firewall entry point exists; creating it with the calendar bypass rule.");
    ruleset = (await wafRequest(`/zones/${zoneId}/rulesets`, {
      method: "POST",
      body: JSON.stringify({
        name: "zone",
        description: "Zone-level phase entry point",
        kind: "zone",
        phase,
        rules: [desiredRule],
      }),
    })).result;
  } else {
    ruleset = entry.result;
    const existing = Array.isArray(ruleset.rules)
      ? ruleset.rules.find((rule) => rule.description === ruleDescription)
      : null;

    if (existing?.id) {
      console.log(`Updating existing Google Calendar importer bypass rule ${existing.id}.`);
      ruleset = (await wafRequest(`/zones/${zoneId}/rulesets/${ruleset.id}/rules/${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify(desiredRule),
      })).result;
    } else {
      console.log("Creating Google Calendar importer bypass rule.");
      ruleset = (await wafRequest(`/zones/${zoneId}/rulesets/${ruleset.id}/rules`, {
        method: "POST",
        body: JSON.stringify({ ...desiredRule, position: { index: 1 } }),
      })).result;
    }
  }

  const installed = Array.isArray(ruleset?.rules)
    ? ruleset.rules.find((rule) => rule.description === ruleDescription)
    : null;
  if (!installed?.id || installed.action !== "skip" || installed.enabled === false) {
    throw new Error("Cloudflare did not return an enabled Google Calendar importer skip rule after provisioning");
  }
  if (installed.expression !== ruleExpression) {
    throw new Error(`Cloudflare returned an unexpected calendar bypass expression: ${installed.expression}`);
  }

  console.log(`Verified Cloudflare calendar importer bypass rule ${installed.id}.`);
  console.log(`Expression: ${installed.expression}`);
} finally {
  if (ephemeral?.id) {
    try {
      await deleteEphemeralToken(ephemeral.id);
    } catch (error) {
      console.error(`Failed to revoke ephemeral WAF token ${ephemeral.id}: ${error.message}`);
      throw error;
    }
  }
}
