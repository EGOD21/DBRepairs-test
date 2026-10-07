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

4. Open `http://SERVER-IP:8080` from the counter and office computers and sign in with the username `admin` and the `DBREPAIRS_PASSWORD` password.
5. Open **Settings → Team** and add an account for each technician.

Only the web port is published. PostgreSQL and the API remain on the private Docker network.

### Security model

- Everyone signs in with their own username and password. The built-in `admin` account uses `DBREPAIRS_PASSWORD`; admins add technicians in **Settings → Team**.
- Admins can change settings, manage the team and create or restore backups. Techs work on repairs, customers, parts and the team chat.
- Passwords are stored as salted scrypt hashes. Sessions last 30 days. Changing someone's password or disabling their account signs them out immediately; changing `DBREPAIRS_PASSWORD` signs everybody out.
- After 10 wrong passwords for one account, sign-in to that account is blocked for 15 minutes.
- Team chat attachments (up to 15 MB each) are stored in PostgreSQL, so the normal backups include them. Only images open in the browser; every other file is downloaded.
- The application connects to PostgreSQL as a restricted account (`APP_DB_USER`, default `dbrepairs_app`). It is not a superuser, so a crafted backup file cannot run commands on the server.
- The connection is plain HTTP. Keep DBRepairs on the shop network. For remote access use a VPN, or a reverse proxy that adds HTTPS.

### Upgrading from 0.3

Sign in with the username `admin` and your existing `DBREPAIRS_PASSWORD`. Nothing else changes in `.env`.

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

## Install on phones and tablets

DBRepairs can be added to the home screen and opens like an app, full screen, with your logo as its icon. This needs HTTPS, which Tailscale Serve provides (`https://yourmachine.your-tailnet.ts.net`). Over plain `http://` the site still works in the browser, but it cannot be installed.

- **iPhone / iPad (Safari):** open the link, tap **Share**, then **Add to Home Screen**.
- **Android (Chrome):** open the link, tap the **⋮** menu, then **Install app** (or **Add to Home screen**).
- **Computer (Chrome / Edge):** click the install icon at the right of the address bar.

The icon comes from the logo in **Settings → Business**. Phones copy the icon when the app is installed: after changing the logo, remove the app from the home screen and add it again to see the new icon.

Only the app's screens and styles are stored on the device. Customer and repair data always come from the server.

## TrueNAS SCALE 25.10

The ready-to-paste configuration is `compose.truenas.yaml`. It uses port `31500` and the images that this repository's GitHub Actions workflow publishes to GitHub Container Registry (`ghcr.io/egod21/dbrepairs-api` and `ghcr.io/egod21/dbrepairs-web`).

The images are published when a change is merged into `main`. GitHub makes new packages private. Make them public once: on GitHub open your profile → **Packages** → `dbrepairs-api` → **Package settings** → **Change visibility** → **Public**. Repeat for `dbrepairs-web`.

Before installing the app, create three datasets under the `Apps` pool using the **Apps** dataset preset:

- `Apps/dbrepairs-postgres` for the PostgreSQL database;
- `Apps/dbrepairs-backups` for automatic dumps;
- `Apps/dbrepairs-photos` for repair photos (grant full control to user ID `1000`).

Their host paths must be:

```text
/mnt/Apps/dbrepairs-postgres
/mnt/Apps/dbrepairs-backups
/mnt/Apps/dbrepairs-photos
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

To update later, change the version number on both `image:` lines (for example `0.6.0` → `0.7.0`) and save.

The optional features in [Optional features (0.7)](#optional-features-07) work the same way on TrueNAS: put the values on the `api` service's `environment:` lines in the YAML (the off-site rclone service is for the plain Docker Compose setup; on TrueNAS use **Data Protection → Cloud Sync Tasks** on the `dbrepairs-backups` and `dbrepairs-photos` datasets instead).

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

## Repair photos

Photos are files in their own Docker volume, `dbrepairs_repair_photos`, mounted at `/data/photos` in the `api` container. The database only records which file belongs to which repair. Keeping them apart means the database stays small and fast, and the photos can be backed up, moved or removed on their own.

```text
postgres_data    → customers, repairs, settings (the database)
postgres_backups → automatic database dumps
repair_photos    → photo files (JPEG/PNG/WebP), about 1 MB each
```

Phones resize photos to at most 2560 px before uploading, and each photo gets a small preview for the gallery.

**What happens to photos**

- Deleting a repair asks whether to delete its photos too or keep them as *archived* photos.
- Saving a repair as Delivered or Cancelled asks whether to keep or delete its photos.
- **Settings → Storage** (admins) shows how much space photos use and how much disk is free, deletes photos of closed repairs or archived photos older than a number of days, lists archived photos, and can turn on automatic cleanup (checked every 6 hours). **Check storage** finds photos whose file is missing and leftover files no repair uses.

**Use a host folder instead of a volume.** Set `PHOTOS_PATH` in `.env` to a folder on the server, for example `PHOTOS_PATH=/srv/dbrepairs-photos`, and give it to the container user (uid 1000):

```bash
sudo mkdir -p /srv/dbrepairs-photos && sudo chown 1000:1000 /srv/dbrepairs-photos
docker compose up -d
```

**Back up photos.** Database backups (`.dump` and `.dbrepairs`) do **not** include photos. Copy them into one file with:

```bash
docker run --rm -v dbrepairs_repair_photos:/photos -v "$PWD":/out alpine tar czf /out/dbrepairs-photos.tgz -C /photos .
```

Restore that file into the volume (stop the API first):

```bash
docker compose stop api
docker run --rm -v dbrepairs_repair_photos:/photos -v "$PWD":/in alpine tar xzf /in/dbrepairs-photos.tgz -C /photos
docker compose start api
```

**Remove all photos for good** (the database keeps working; run **Settings → Storage → Check storage → Clean these up** afterwards to remove the records):

```bash
docker compose rm -sf api          # removes only the api container, not its data
docker volume rm dbrepairs_repair_photos
docker compose up -d               # recreates the api with a new, empty photos volume
```

`docker compose stop` / `start` and `docker compose down` (without `--volumes`) never touch the photos.

## Optional features (0.7)

Everything in this section is **off until you set it up**. The app works without any of it.

```text
.env setting          what it turns on
────────────────────  ──────────────────────────────────────────────
VAULT_KEY             encrypted password vault on customer profiles
SMTP_*                email sent by the server (instead of your mail app)
TWILIO_*              text messages (SMS)
OFFSITE_REMOTE        nightly copy of backups + photos to cloud storage
Settings screen       what it turns on
────────────────────  ──────────────────────────────────────────────
Notifications         automatic "received" / "ready" customer messages,
                      the public repair status page
My account            phone notifications for each staff member
```

After changing `.env`, apply it with `docker compose up -d` (this recreates only the containers whose settings changed; your data stays).

### Password vault (`VAULT_KEY`)

Customer logins (router admin, Wi-Fi, server iDRAC…) are stored encrypted with AES-256-GCM. The key comes from `VAULT_KEY`, never from the database, so a stolen backup does not reveal them.

```bash
openssl rand -base64 32      # paste the result after VAULT_KEY= in .env
docker compose up -d
```

Keep a copy of the key somewhere safe (a password manager). **If the key is lost or changed, saved passwords cannot be read.** Every time someone reveals a password it is written to the activity log. Admins can stop technicians from seeing the vault in **Settings → Intake & vault**.

### Email and text messages

Without these settings, email buttons open your own email app, as before. With them, DBRepairs sends the message itself and keeps a copy under **Messages sent** on the repair and the customer.

```ini
SMTP_HOST=smtp.office365.com     # or smtp.gmail.com, your host's SMTP server…
SMTP_PORT=587                    # 587 = STARTTLS, 465 = TLS, 25 = plain
SMTP_USER=shop@example.com
SMTP_PASSWORD=app-password       # Gmail / Microsoft 365: create an "app password"
SMTP_FROM=Your Shop <shop@example.com>

TWILIO_ACCOUNT_SID=AC…           # optional, from console.twilio.com
TWILIO_AUTH_TOKEN=…
TWILIO_FROM=+15550001234         # your Twilio number
```

Then in **Settings → Notifications** the channels show *ready*, and you can turn on automatic messages when a repair is booked in and when it is ready for pickup. Customers whose preferred contact is SMS get a text; everyone else gets an email.

### Customer status page (Tailscale Funnel)

Each repair can have a private link like `https://shop.tail1234.ts.net:8443/status/Xk3…` that shows the customer the repair number, device, status, dates and any balance due. Nothing else becomes public.

The rest of DBRepairs stays private on your tailnet. Tailscale Funnel publishes **only the `/status` path** to the internet, on port 8443 (your normal Tailscale Serve address on 443 is unchanged):

```bash
# on the DBRepairs server, once
sudo tailscale funnel --bg --https=8443 --set-path=/status http://127.0.0.1:8080/status
tailscale funnel status          # shows the public address
```

Funnel must be allowed for this machine in the Tailscale admin console (Access controls → `nodeAttrs` → `funnel`); the command prints a link if it is not. Then in **Settings → Notifications** tick *Let customers check their repair*, enter the public address without a path (for example `https://shop.tail1234.ts.net:8443`) and save. The link appears on the repair page, in automatic messages and on printed receipts and intake sheets. To stop publishing: `sudo tailscale funnel --https=8443 off`.

### Phone notifications

Each person opens **Settings → My account → Phone notifications → Turn on for this device**, on each phone or computer. They are notified when a repair is assigned to them, when a chat message arrives and when a repair is about to miss its SLA.

- This needs HTTPS, which Tailscale Serve already gives you.
- On iPhone and iPad (iOS 16.4+), first add DBRepairs to the Home Screen (Share → Add to Home Screen) and turn notifications on from the installed app.
- Nothing needs to be configured on the server: it creates its own signing keys on first use.

### Calendar feeds

**Schedule → Add to my phone calendar** gives each person a private calendar address with their appointments. Apple Calendar, Outlook and Thunderbird on devices in your tailnet can subscribe to it. Google Calendar fetches feeds from Google's own servers, which cannot reach a private tailnet address. **New link** makes the old address stop working.

### Off-site backups (rclone)

The `offsite` service copies the database dumps and the photos to cloud storage (Backblaze B2, Amazon S3, Google Drive, another server over SFTP and [many more](https://rclone.org/overview/)) once a day. It only runs when started with the `offsite` profile.

1. Create the remote once (an interactive question-and-answer setup; give it a short name such as `b2`):

   ```bash
   docker compose run --rm --entrypoint rclone offsite config
   ```

   The answers are saved in `rclone/rclone.conf` next to `compose.yaml`. That file contains storage passwords: it is excluded from git, so keep a copy of it in your password manager.
2. In `.env`, set the destination: `OFFSITE_REMOTE=b2:my-bucket/dbrepairs`.
3. Start it, and check the first copy:

   ```bash
   docker compose --profile offsite up -d
   docker compose logs -f offsite
   ```

The copy mirrors the folders: when the server deletes an expired dump, the off-site copy deletes it too. Turn on versioning or object lock in your bucket if you want older copies kept longer.

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

Database migrations run automatically and transactionally when the API starts. Persistent data remains in the `postgres_data` volume, and photos in the `repair_photos` volume.

To stop the application without deleting data:

```bash
docker compose down
```

Do not add `--volumes` unless the PostgreSQL data, backup and photo volumes are intentionally being deleted.

## Development

Start PostgreSQL and the API, then run Vite locally:

```bash
docker compose up -d db db-init api
npm run dev
```

Vite forwards `/api` to `http://localhost:3000`. A normal browser session uses the server API; a Tauri session continues to use SQLite.
