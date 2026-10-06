# DBRepairs 0.3.0

DBRepairs 0.3 secures the server edition and fixes several data issues found in a code review.

## Server edition: security

- Sign-in with a shared shop password (`DBREPAIRS_PASSWORD`). Every API route except the health check now requires a session.
- Sessions use an HttpOnly, SameSite=Strict cookie that lasts 30 days. Changing the password signs everybody out.
- Repeated wrong passwords are throttled: 10 failures from one address block it for 15 minutes.
- Requests that browsers mark as coming from another website are refused.
- The application now uses a restricted PostgreSQL account (`APP_DB_USER`, default `dbrepairs_app`). Previously it used the superuser, so a crafted backup file restored through the web interface could run commands on the database server.
- A new `db-init` step creates that account and moves existing tables to it. Data is kept.
- The API refuses to start while any password is still the example value.
- The web server sends a Content-Security-Policy and other security headers.

**Upgrading:** add `APP_DB_PASSWORD` and `DBREPAIRS_PASSWORD` to your `.env`, Portainer stack or TrueNAS YAML. See `docker/README.md`.

## Deployment

- `compose.truenas.yaml` uses this fork's own images, pinned to a version, instead of the upstream `latest` images.
- The API image pins `postgresql17-client`, so backups always match the PostgreSQL 17 server.
- CI runs the server tests, the frontend type check and build, the desktop Rust tests, the image builds and an nginx config check on every pull request. Images are published only after the tests pass on `main`.

## Fixes

- Desktop: dates and times are no longer shown one hour early in summer. SQLite stores UTC without a zone, and it was being read as local time.
- Portable backups from desktop to server keep the correct time for the same reason.
- CSV exports neutralize cells that a spreadsheet would run as a formula, such as `=HYPERLINK(...)`.
- Desktop: creating or editing a repair is now all-or-nothing. A failure can no longer leave a repair with a `TMP-...` number or a missing history entry.
- Desktop: backups are consistent snapshots (`VACUUM INTO`) instead of raw file copies.
- Desktop: restoring a backup sends the file as raw bytes, using far less memory on large databases.
- Desktop: a Content-Security-Policy is enabled, and export filenames are limited to plain names.
- The version number is the same everywhere and the interface reads it from `package.json`.
