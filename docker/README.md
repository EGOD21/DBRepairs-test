# DBRepairs Server / Docker

The server edition uses the existing React interface with a central API and PostgreSQL database. The Tauri desktop edition remains separate and continues to use its local SQLite database.

## Quick start

1. Copy `.env.example` to `.env`.
2. Replace the three passwords with different long, unique values:
   - `POSTGRES_PASSWORD`: database administrator, used only by the one-time `db-init` step;
   - `APP_DB_PASSWORD`: the restricted database account the application and backups use;
   - `DBREPAIRS_PASSWORD`: the password people type to sign in (at least 8 characters).
3. Start the stack:

   ```bash
   docker compose up -d --build
   ```

4. Open `http://SERVER-IP:8080` from the counter and office computers and sign in with `DBREPAIRS_PASSWORD`.

Only the web port is published. PostgreSQL and the API remain on the private Docker network.

### Security model

- Everyone signs in with one shared shop password (`DBREPAIRS_PASSWORD`). Sessions last 30 days. Changing the password signs everybody out.
- After 10 wrong passwords from one address, sign-in from that address is blocked for 15 minutes.
- The application connects to PostgreSQL as a restricted account (`APP_DB_USER`, default `dbrepairs_app`). It is not a superuser, so a crafted backup file cannot run commands on the server.
- The connection is plain HTTP. Keep DBRepairs on the shop network. For remote access use a VPN, or a reverse proxy that adds HTTPS.

### Upgrading from 0.2

Add `APP_DB_PASSWORD` and `DBREPAIRS_PASSWORD` to `.env` (or the Portainer stack), then run `docker compose up -d --build`. The `db-init` step moves ownership of the existing tables to the restricted account. Your data is kept.

## Portainer

Deploy the repository as a Git stack so that Portainer has the Dockerfiles and build context. Use `compose.yaml` and define these environment variables in the stack:

- `POSTGRES_PASSWORD` (required, database administrator);
- `APP_DB_PASSWORD` (required, restricted application account);
- `DBREPAIRS_PASSWORD` (required, sign-in password, at least 8 characters);
- `APP_DB_USER` (default `dbrepairs_app`);
- `DBREPAIRS_PORT` (default `8080`);
- `POSTGRES_DB` and `POSTGRES_USER` (both default to `dbrepairs`);
- `BACKUP_INTERVAL_SECONDS` (default one day);
- `BACKUP_RETENTION_DAYS` (default 14 days);
- `TZ` (default `Europe/Lisbon`).

After deployment, `db`, `api`, `web` and `backup` should be healthy or running. `db-init` runs once at each start and then shows as exited. That is normal.

## TrueNAS SCALE 25.10

The ready-to-paste configuration is `compose.truenas.yaml`. It uses port `31500` and the images that this repository's GitHub Actions workflow publishes to GitHub Container Registry (`ghcr.io/egod21/dbrepairs-api` and `ghcr.io/egod21/dbrepairs-web`).

The images are published when a change is merged into `main`. GitHub makes new packages private. Make them public once: on GitHub open your profile → **Packages** → `dbrepairs-api` → **Package settings** → **Change visibility** → **Public**. Repeat for `dbrepairs-web`.

Before installing the app, create two datasets under the `Apps` pool using the **Apps** dataset preset:

- `Apps/dbrepairs-postgres` for the PostgreSQL database;
- `Apps/dbrepairs-backups` for automatic dumps.

Their host paths must be:

```text
/mnt/Apps/dbrepairs-postgres
/mnt/Apps/dbrepairs-backups
```

If PostgreSQL reports a permission error, edit the ACL for `dbrepairs-postgres` and grant full control to user ID `70`, the `postgres` user in the Alpine image.

In TrueNAS:

1. Open **Apps → Discover Apps**.
2. Open the actions menu and select **Install via YAML**.
3. Use `dbrepairs` as the application name.
4. Copy all of `compose.truenas.yaml` into **Custom Config**.
5. Replace the three `CHANGE-THIS-...` passwords at the top with different long, unique values. The last one is the sign-in password.
6. Save and wait for the containers to start. `db-init` stops after a few seconds; that is expected.
7. Open `http://TRUENAS-IP:31500` and sign in.

To update later, change the version number on both `image:` lines (for example `0.3.0` → `0.3.1`) and save.

TrueNAS custom YAML apps currently use a generic icon in the Apps list. The DBRepairs web interface and browser favicon use `dbrepairs-icon-square.png`.

## Backups

The `backup` service creates a PostgreSQL custom-format dump immediately after the API is healthy and then at the configured interval. Files are stored in the `postgres_backups` Docker volume and expired according to `BACKUP_RETENTION_DAYS`.

A manual dump can also be downloaded from **Settings → Create backup** in the web interface. Keep an additional copy outside the Docker host.

The web interface can restore these `.dump` files with **Settings → Restore backup**. Before replacing the database, the browser automatically downloads a safety backup of the current data. Restore runs in one PostgreSQL transaction: if any step fails, the existing database is left unchanged. Do not close the page while the restore is running.

### Portable SQLite/PostgreSQL backups

Use **Settings → Portable backup** to create a `.dbrepairs` file. Unlike the native `.db` and `.dump` formats, this application-level archive works in both directions:

```text
Desktop SQLite → Server PostgreSQL
Server PostgreSQL → Desktop SQLite
```

It includes company settings and logo, repair statuses, customers, repairs and complete status history. Restoring replaces all current application data after automatically creating a native safety backup. The archive is validated before replacement and imported in one database transaction.

Use native backups for disaster recovery of the same database engine. Use portable backups to move or clone DBRepairs data between desktop and server editions.

List automatic backups:

```bash
docker compose exec backup sh -c 'ls -lh /backups'
```

Copy one to the current directory:

```bash
docker compose cp backup:/backups/DBRepairs-YYYYMMDD-HHMMSS.dump ./DBRepairs.dump
```

Restore into an empty or deliberately replaceable database during a maintenance window:

```bash
docker compose stop web api backup
docker compose cp ./DBRepairs.dump db:/tmp/DBRepairs.dump
docker compose exec db pg_restore --clean --if-exists --no-owner --no-privileges -U dbrepairs_app -d dbrepairs /tmp/DBRepairs.dump
docker compose start api backup web
```

Restore as the restricted account (`-U dbrepairs_app`), never as the administrator, so the dump cannot run privileged commands. Change the arguments if `POSTGRES_DB` or `APP_DB_USER` were customized. Restoring overwrites server data; take a fresh backup first.

## Operations

View service state and logs:

```bash
docker compose ps
docker compose logs -f api db backup
```

Update after pulling a new release:

```bash
docker compose up -d --build
```

Database migrations run automatically and transactionally when the API starts. Persistent data remains in the `postgres_data` volume.

To stop the application without deleting data:

```bash
docker compose down
```

Do not add `--volumes` unless the PostgreSQL data and backup volumes are intentionally being deleted.

## Development

Start PostgreSQL and the API, then run Vite locally:

```bash
docker compose up -d db db-init api
npm run dev
```

Vite forwards `/api` to `http://localhost:3000`. A normal browser session uses the server API; a Tauri session continues to use SQLite.
