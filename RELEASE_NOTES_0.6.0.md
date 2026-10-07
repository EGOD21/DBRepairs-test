# DBRepairs 0.6.0

## Repair photos (server edition)

- **Photos on every repair.** Add as many as you need from a phone camera (**Camera** button) or from a computer (**Add photos**, or drag files onto the Photos card). Phones shrink each photo to at most 2560 px (about 1 MB) before uploading, and the gallery uses small previews so it stays fast.
- **Viewer:** tap a photo to open it full screen. Swipe or use the arrow keys to move between photos, add a caption, download or delete it.
- **Select mode:** pick several photos to print, download or delete at once.
- **Print photos** from the Print menu or from select mode: A4 sheets with the shop logo, repair number, customer and device, 1, 2, 4 or 6 photos per page and optional captions.
- **Deleting a repair** asks whether to delete its photos too or keep them as archived photos.
- **Closing a repair** (Delivered or Cancelled) asks whether to keep or delete its photos.
- The repairs list shows a camera badge with the number of photos.

## Storage

- Photos are files in their own Docker volume (`repair_photos`), not in the database, so they can be backed up, moved or removed on their own. Set `PHOTOS_PATH` to use a folder on the host instead.
- New **Settings → Storage** page (admins): space used by all photos, closed repairs and archived photos; free disk space; delete old photos now; automatic cleanup after 30/90/180/365 days or a custom number of days; archived photos list with a viewer; a check for missing or leftover files.
- Database backups do not include photos. See *Repair photos* in `docker/README.md` for one-line backup, restore and removal commands.

## Settings

- Each settings area is now its own page with its own address, for example `#/settings/appearance` or `#/settings/storage`, instead of one long page.

## Upgrading

`docker compose up -d --build` in the DBRepairs folder. Compose creates the new photos volume automatically. On TrueNAS, create the `Apps/dbrepairs-photos` dataset (owned by user ID 1000) before updating the YAML.
