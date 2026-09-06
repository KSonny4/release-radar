const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const bootstrapToken = process.env.CLOUDFLARE_API_TOKEN;
const allowedEmail = process.env.ACCESS_ALLOWED_EMAIL;

if (!accountId || !bootstrapToken || !allowedEmail) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and ACCESS_ALLOWED_EMAIL are required");
}

const apiBase = "https://api.cloudflare.com/client/v4";

async function requestWith(token, path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const errors = Array.isArray(data.errors) && data.errors.length
      ? data.errors.map((e) => `${e.code ?? "?"}: ${e.message ?? e.error ?? "Cloudflare API error"}`).join("; ")
      : `HTTP ${response.status}`;
    const error = new Error(`${path}: ${errors}`);
    error.status = response.status;
    error.cloudflareErrors = data.errors;
    throw error;
  }
  return data.result;
}

const bootstrapRequest = (path, init = {}) => requestWith(bootstrapToken, path, init);

async function createEphemeralAccessToken() {
  const groups = await bootstrapRequest(`/accounts/${accountId}/tokens/permission_groups`);
  const accessGroup = groups.find((group) =>
    (group.name === "Access: Apps and Policies Write" || group.name === "Access: Apps and Policies Edit") &&
    Array.isArray(group.scopes) && group.scopes.includes("com.cloudflare.api.account")
  );
  if (!accessGroup) {
    const candidates = groups
      .filter((group) => String(group.name || "").includes("Access: Apps and Policies"))
      .map((group) => ({ name: group.name, scopes: group.scopes }));
    throw new Error(`Could not find account-scoped Access write permission group. Candidates: ${JSON.stringify(candidates)}`);
  }

  const expiresOn = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const created = await bootstrapRequest(`/accounts/${accountId}/tokens`, {
    method: "POST",
    body: JSON.stringify({
      name: `release-radar-access-${Date.now()}`,
      policies: [{
        effect: "allow",
        resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
        permission_groups: [{ id: accessGroup.id }],
      }],
      expires_on: expiresOn,
    }),
  });

  if (!created?.id || !created?.value) throw new Error("Cloudflare created an Access token without returning its id/value");
  console.log(`Created ephemeral Access-only token ${created.id}; expires ${expiresOn}`);
  return { id: created.id, value: created.value };
}

async function deleteEphemeralToken(id) {
  await bootstrapRequest(`/accounts/${accountId}/tokens/${id}`, { method: "DELETE" });
  console.log(`Revoked ephemeral Access-only token ${id}`);
}

const desiredApps = [
  {
    name: "Release Radar Series Feed",
    domain: "radar.pkubelka.cz/calendar/series.ics",
    destination: "radar.pkubelka.cz/calendar/series.ics",
    policy: {
      name: "Bypass Series calendar feed",
      decision: "bypass",
      include: [{ everyone: {} }],
    },
  },
  {
    name: "Release Radar Movies Feed",
    domain: "radar.pkubelka.cz/calendar/movies.ics",
    destination: "radar.pkubelka.cz/calendar/movies.ics",
    policy: {
      name: "Bypass Movies calendar feed",
      decision: "bypass",
      include: [{ everyone: {} }],
    },
  },
  {
    name: "Release Radar Health",
    domain: "radar.pkubelka.cz/healthz",
    destination: "radar.pkubelka.cz/healthz",
    policy: {
      name: "Bypass health check",
      decision: "bypass",
      include: [{ everyone: {} }],
    },
  },
  {
    name: "Release Radar",
    domain: "radar.pkubelka.cz",
    destination: "radar.pkubelka.cz/*",
    policy: {
      name: "Petr only",
      decision: "allow",
      include: [{ email: { email: allowedEmail } }],
    },
  },
];

let ephemeral;
try {
  ephemeral = await createEphemeralAccessToken();
  const accessRequest = (path, init = {}) => requestWith(ephemeral.value, path, init);
  const scope = `/accounts/${accountId}`;
  const existingApps = await accessRequest(`${scope}/access/apps?per_page=200`);
  const radarApps = existingApps
    .filter((app) => String(app.domain || "").startsWith("radar.pkubelka.cz"))
    .map((app) => ({ id: app.id, name: app.name, domain: app.domain }));
  console.log(`Existing Release Radar Access apps: ${JSON.stringify(radarApps)}`);

  for (const app of desiredApps) {
    const existing = existingApps.find((candidate) => candidate.name === app.name || candidate.domain === app.domain);
    const body = {
      name: app.name,
      type: "self_hosted",
      domain: app.domain,
      destinations: [{ type: "public", uri: app.destination }],
      app_launcher_visible: false,
      session_duration: "24h",
      policies: [app.policy],
    };

    console.log(`${existing ? "Updating" : "Creating"} Access app ${app.name}`);
    const result = existing
      ? await accessRequest(`${scope}/access/apps/${existing.id}`, { method: "PUT", body: JSON.stringify(body) })
      : await accessRequest(`${scope}/access/apps`, { method: "POST", body: JSON.stringify(body) });
    console.log(`${existing ? "updated" : "created"}: ${result.name}`);
  }
} finally {
  if (ephemeral?.id) {
    try {
      await deleteEphemeralToken(ephemeral.id);
    } catch (error) {
      console.error(`Failed to revoke ephemeral Access token ${ephemeral.id}: ${error.message}`);
      throw error;
    }
  }
}
