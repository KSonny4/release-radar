const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const allowedEmail = process.env.ACCESS_ALLOWED_EMAIL;

if (!accountId || !token || !allowedEmail) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and ACCESS_ALLOWED_EMAIL are required");
}

const apiBase = "https://api.cloudflare.com/client/v4";
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

async function cf(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const errors = Array.isArray(data.errors) ? data.errors.map((e) => `${e.code ?? "?"}: ${e.message ?? "Cloudflare API error"}`).join("; ") : `HTTP ${response.status}`;
    throw new Error(`${path}: ${errors}`);
  }
  return data.result;
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

const existingApps = await cf(`/accounts/${accountId}/access/apps?per_page=200`);

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

  const result = existing
    ? await cf(`/accounts/${accountId}/access/apps/${existing.id}`, { method: "PUT", body: JSON.stringify(body) })
    : await cf(`/accounts/${accountId}/access/apps`, { method: "POST", body: JSON.stringify(body) });

  console.log(`${existing ? "updated" : "created"}: ${result.name}`);
}
