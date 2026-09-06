# Release Radar

Self-hosted TV-series and movie release browser for **radar.pkubelka.cz**, built entirely on **Cloudflare Workers + D1**.

## What it does

- Imports the TVmaze show catalogue incrementally, up to five pages per 15-minute cron by default.
- Imports TVmaze's full future episode schedule daily.
- Lets you browse/filter series by search, genre, status, rating and sort order.
- Shows brand-new series premieres separately.
- Lets the admin follow/unfollow series.
- Exposes a private subscribable series calendar at `/calendar/series.ics?token=...`.
- Imports upcoming TMDB movies for the Czech region, including local release type/date when TMDB provides it.
- Lets you browse/filter movies by genre, rating, vote count, release window and popularity.
- Keeps movie calendar selection intentionally unimplemented until the ranking/selection rules are decided.

## Cloudflare architecture

- **Worker**: UI, API, iCalendar feed and scheduled ingestion.
- **D1**: series, episodes, followed shows, movies and sync cursors.
- **Cron Trigger**: every 15 minutes. TVmaze show pages and TMDB movie pages are incremental. The full future episode schedule runs roughly once per day.
- **Custom Domain**: `radar.pkubelka.cz`.
- **GitHub Actions**: deploys `master`, auto-provisions the D1 binding, applies migrations and optionally syncs application secrets.

The sync is deliberately kept below the Cloudflare Workers Free-plan default subrequest ceiling. A normal run uses at most roughly 47 external requests: five TVmaze show-index pages plus two TMDB Discover pages and up to 40 TMDB movie-detail calls. A due full-schedule sync adds one more TVmaze request.

## One-time Cloudflare / GitHub setup

The repository is deployment-ready, but credentials cannot be created from repository code.

### 1. Cloudflare prerequisites

`pkubelka.cz` must be an active zone in the Cloudflare account used for deployment.

`radar.pkubelka.cz` must **not** already have a conflicting CNAME. The Worker config declares it as a Cloudflare **Custom Domain**, so Cloudflare creates the required DNS record and certificate during deployment.

### 2. Create a Cloudflare API token

Start with Cloudflare's **Edit Cloudflare Workers** token template and scope it to the correct account/`pkubelka.cz` zone. Also add **D1 Edit/Write** because the workflow provisions and migrates D1.

### 3. Add GitHub Actions secrets

Open:

`https://github.com/KSonny4/release-radar/settings/secrets/actions`

Required for deployment:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Recommended application secrets:

- `TMDB_BEARER_TOKEN` - enables movie ingestion.
- `ADMIN_TOKEN` - long random value used to log into `/login` and modify followed series / run manual sync.
- `CALENDAR_TOKEN` - separate long random value used in the private iCalendar URL.

If the three application secrets are absent, the Worker still deploys and series browsing can bootstrap, but the relevant features show as unconfigured.

### 4. Push to `master`

`.github/workflows/deploy.yml` will:

1. type-check the Worker,
2. run `wrangler deploy`,
3. automatically provision the `DB` D1 binding if needed,
4. apply `migrations/0001_init.sql`,
5. copy optional app secrets to the Worker,
6. smoke-check `https://radar.pkubelka.cz/healthz`.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Open `http://localhost:8787`.

## Production URLs

- `https://radar.pkubelka.cz/`
- `https://radar.pkubelka.cz/series`
- `https://radar.pkubelka.cz/new-series`
- `https://radar.pkubelka.cz/movies`
- `https://radar.pkubelka.cz/login`
- `https://radar.pkubelka.cz/admin`
- `https://radar.pkubelka.cz/healthz`
- `https://radar.pkubelka.cz/calendar/series.ics?token=<CALENDAR_TOKEN>`

## Data-source notes

TVmaze provides its show index specifically for building a local catalogue. Release Radar walks that index incrementally and stores it in D1. Its `/schedule/full` endpoint provides all future episodes known to TVmaze and is used for the calendar.

TMDB is used for upcoming movies, ratings, vote counts, popularity, posters and regional release-date metadata. For Czech releases the importer prefers release type in this order: theatrical, limited theatrical, digital, premiere, physical, TV. If TMDB has no CZ-specific release entry, it falls back to the primary release date.

The UI includes TVmaze and TMDB attribution. Check both providers' current licence terms before commercialising the service.

## Future movie calendar

The movie catalogue deliberately stops before calendar selection. The intended next layer is:

```text
movies in D1
   -> ranking / personal rules
   -> selected movies
   -> separate /calendar/movies.ics feed
```

That means we can later decide whether "cool" means popularity, minimum vote count, rating, genres, studios, cast, language, cinema-only releases, streaming releases, or an explicit manual watchlist without replacing the ingestion layer.
