const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const allowedEmail = process.env.ACCESS_ALLOWED_EMAIL;

if (!token || !allowedEmail || (!accountId && !zoneId)) {
  throw new Error("CLOUDFLARE_API_TOKEN, ACCESS_ALLOWED_EMAIL and an account or zone ID are required");
}

const apiBase = "https://api.cloudflare.com/client/v4";
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

async function request(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const errors = Array.isArray(data.errors) && data.errors.length
      ? data.errors.map((e) => `${e.code ?? "?"}: ${e.message ?? "Cloudflare API error"}`).join("; ")
      : `HTTP ${response.status}`;
    const error = new Error(`${path}: ${errors}`);
    error.status = response.status;
    error.cloudflareErrors = data.errors;
    throw error;
  }
  return data.result;
}

async function diagnoseToken() {
  const candidates = accountId
    ? [
        {
          kind: "account-owned",
          verify: `/accounts/${accountId}/tokens/verify`,
          detail: (id) => `/accounts/${accountId}/tokens/${id}`,
        },
        {
          kind: "user-owned",
          verify: "/user/tokens/verify",
          detail: (id) => `/user/tokens/${id}`,
        },
      ]
    : [{ kind: "user-owned", verify: "/user/tokens/verify", detail: (id) => `/user/tokens/${id}` }];

  for (const candidate of candidates) {
    try {
      const verified = await request(candidate.verify);
      console.log(`Cloudflare token identity: ${candidate.kind}; id=${verified.id}; status=${verified.status}`);
      try {
        const details = await request(candidate.detail(verified.id));
        const safePolicies = (details.policies || []).map((policy) => ({
          effect: policy.effect,
          permissions: (policy.permission_groups || []).map((permission) => permission.name || permission.id),
          resourceKeys: Object.keys(policy.resources || {}),
        }));
        console.log(`Cloudflare token name: ${details.name || "(unnamed)"}`);
        console.log(`Cloudflare token policies: ${JSON.stringify(safePolicies)}`);
      } catch (error) {
        console.log(`Cloudflare token details are not introspectable with this token: ${error.status || "?"}`);
      }
      return;
    } catch {
      // Try the other token ownership model.
    }
  }
  console.log("Cloudflare token verify endpoint did not identify the token ownership model; continuing with API capability checks.");
}

async function chooseScope() {
  const scopes = [];
  if (zoneId) scopes.push(`/zones/${zoneId}`);
  if (accountId) scopes.push(`/accounts/${accountId}`);

  let lastError;
  for (const scope of scopes) {
    try {
      const apps = await request(`${scope}/access/apps?per_page=200`);
      console.log(`Using Cloudflare Access scope ${scope.startsWith("/zones/") ? "zone" : "account"}`);
      const radarApps = apps
        .filter((app) => String(app.domain || "").startsWith("radar.pkubelka.cz"))
        .map((app) => ({ id: app.id, name: app.name, domain: app.domain, type: app.type }));
      console.log(`Existing Release Radar Access apps visible to token: ${JSON.stringify(radarApps)}`);
      return { scope, apps };
    } catch (error) {
      lastError = error;
      console.warn(`Access scope ${scope} unavailable: ${error.message}`);
    }
  }
  throw lastError ?? new Error("No usable Cloudflare Access API scope");
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

await diagnoseToken();
const { scope, apps: existingApps } = await chooseScope();

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

  console.log(`${existing ? "Updating" : "Creating"} Access app ${app.name}${existing ? ` (${existing.id})` : ""}`);
  const result = existing
    ? await request(`${scope}/access/apps/${existing.id}`, { method: "PUT", body: JSON.stringify(body) })
    : await request(`${scope}/access/apps`, { method: "POST", body: JSON.stringify(body) });

  console.log(`${existing ? "updated" : "created"}: ${result.name}`);
}
