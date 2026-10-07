# DBRepairs

DBRepairs is a simple, open-source repair-shop manager focused on the practical day-to-day workflow of repair workshops and service centres.

The project is a clean rewrite with a shared React/TypeScript interface. It can run as a Tauri 2 desktop application with local SQLite, or as a Docker server with a central PostgreSQL database.

## Features

### Customers

- Full customer profiles: residential or commercial, contact person, phone, mobile, email, address, tags and notes.
- Retainer clients with plan, monthly fee and renewal date.
- Profile page with repair history, open repairs, total billed and last visit.
- One-click email (mailto), call and text links.
- View the complete repair history directly from the customer record.
- Create a new customer directly while opening a repair.

### Repairs

- Create, edit and delete repair jobs.
- Priority, promised date (with overdue tracking), technician, deposit, paid flag and warranty.
- Parts to order per repair: part, part number, supplier, order link, quantity, cost and status (to order → ordered → received → installed).
- Email templates for the customer: received, estimate approval, waiting for parts, ready for pickup and thank you.
- Repair number generated automatically.
- Device type, brand, model, serial number and IMEI.
- Reported fault, accessories and general condition.
- Diagnosis and work performed.
- Estimated and final values.
- Internal notes.
- Search and filter repairs by status and open/closed state.
- Suggestions for previously used device types, brands and models.
- Server edition: any number of photos per repair, taken with a phone camera or uploaded from a computer, with a full-screen viewer, captions, downloads and A4 photo sheets (1, 2, 4 or 6 per page).

### Status workflow

Initial repair statuses:

- Received
- Diagnosis
- Waiting for customer
- Waiting for parts
- In repair
- Repaired
- Ready
- Delivered
- Cancelled

Every status change is stored with date and time. An optional note can be added to each status change.

### Printing

- Three ticket types: A4 intake sheet, device label with barcode (62×29 mm, 89×36 mm, 4×2 in or 4×6 in) and 80 mm customer receipt.
- Optional automatic printing right after a repair is created.
- Scanning a label's barcode in the repairs search opens that repair.
- A4 portrait repair intake sheet.
- Two copies on the same page:
  - workshop copy;
  - customer copy.
- Dashed cut line between copies.
- Company identity and custom logo.
- Save a repair and immediately open the print preview.

### Dashboard

Live overview with:

- open repairs;
- waiting for customer;
- ready for collection;
- closed today;
- latest repairs.

### Settings and data

- Each settings area has its own page (`#/settings/appearance`, `#/settings/storage`, …).
- Global application language.
- Appearance: every color, the fonts and the corner roundness can be changed, with presets (HubSpot-style default, Neutral, Dark, Ocean).
- Company logo shown in the sidebar, the browser tab, the sign-in page and on every ticket.
- Portuguese (Portugal), English, Spanish and French.
- Company name, tax number, address, phone, email and logo.
- Manual SQLite database backup.
- CSV export for customers.
- CSV export for repairs.

### Server edition

- One central PostgreSQL database for simultaneous use from multiple computers.
- Personal sign-ins for every team member, with admin and tech roles.
- Team chat: one shared channel with tags, open-question tracking, file attachments and clickable links and repair numbers.
- Installable on phones and tablets as an app (PWA) with the shop logo as its icon, and a phone layout with bottom tabs.
- Browser interface reusing the desktop workflow and translations.
- Transactional HTTP API and automatic schema migrations.
- Docker Compose stack for a server or Portainer.
- Repair photos kept in their own Docker volume, with Settings → Storage to see usage, delete old photos or turn on automatic cleanup.
- **Billing:** time tracking with running timers, estimates the customer approves and signs on screen, invoices, partial payments, a printable invoice with an optional payment link, and CSV export for QuickBooks or Xero.
- **Retainer clients:** contracts with included hours, monthly invoices made automatically, SLA response and resolution targets with warnings, and recurring maintenance visits that open repairs on schedule.
- **Client records:** equipment (assets) with serial numbers and history, network notes, documents, an encrypted password vault, intake checklists with waivers and signatures, and data-wipe certificates.
- **Shop floor:** parts inventory with low-stock alerts, supplier returns (RMAs), warranty comebacks linked to the original repair, an unclaimed-devices list, and a team schedule that can be added to phone calendars.
- **Communication:** email and SMS sent from the server, automatic "received" and "ready" messages, an optional public status page for customers, and phone notifications for staff.
- **Tools:** camera barcode scanning, checklists for repair procedures, a searchable knowledge base, reports with charts, and an activity log of who changed what.
- Manual and scheduled PostgreSQL backups with configurable retention, plus an optional off-site copy with rclone.
- Portable `.dbrepairs` backups for two-way transfer between SQLite and PostgreSQL.

## Technology

- React
- TypeScript
- Vite
- Tauri 2
- Rust
- SQLite
- Node.js API and PostgreSQL (server edition)
- Docker Compose and nginx (server edition)

## Linux installation

### Debian / Ubuntu and derivatives

Download the `.deb` package and install it with:

```bash
sudo apt install ./DBRepairs_0.7.0_amd64.deb
```

### Fedora / RHEL compatible distributions

Download the `.rpm` package and install it with your distribution package manager, for example:

```bash
sudo dnf install ./DBRepairs-0.7.0-1.x86_64.rpm
```

## Development

Prerequisites: Node.js, Rust and the platform dependencies required by Tauri 2.

```bash
npm install
npm run tauri dev
```

Build:

```bash
npm run tauri build
```

Native packages should normally be built on the target operating system or through CI.

### Server / Docker

Copy `.env.example` to `.env`, replace the three passwords (`POSTGRES_PASSWORD`, `APP_DB_PASSWORD` and the sign-in password `DBREPAIRS_PASSWORD`), then run:

```bash
docker compose up -d --build
```

Open `http://SERVER-IP:8080`. See `docker/README.md` for Portainer, backup, restore and update instructions.

## Data location

The desktop edition uses a local SQLite database. Application data is stored in the platform-specific application configuration directory.

Use the built-in backup function before moving or reinstalling systems.

The server edition stores shared data in its PostgreSQL Docker volume, and repair photos as files in a separate `repair_photos` volume (see [docker/README.md](docker/README.md#repair-photos)). Desktop and server data remain independent until a portable `.dbrepairs` backup is explicitly restored. This format transfers settings, statuses, customers, repairs and status history in either direction between SQLite and PostgreSQL.

## Translation

See `TRANSLATING.md`.

The application uses one global language for the interface, forms, statuses and printed documents.

## Project principles

- Keep the workflow simple.
- Fast repair intake and lookup.
- Avoid unnecessary ERP complexity.
- SQLite by default.
- Desktop SQLite remains simple and independent.
- Docker/server edition reuses the same frontend and domain workflow.
- Easy community translations.

## License

DBRepairs is licensed under GPL-3.0. See `LICENSE`.
