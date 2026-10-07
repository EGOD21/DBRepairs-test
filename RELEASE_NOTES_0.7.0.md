# DBRepairs 0.7.0

Everything below is in the **server edition** (Docker / TrueNAS). The desktop app is unchanged. Features that need an outside service (email, SMS, the public status page, off-site backups) stay off until you set them up; see *Optional features* in `docker/README.md`.

## Billing

- **Time tracking.** Start a timer on a repair (it keeps running if you close the page; the running timer shows at the top of every page), or add time by hand. Time can be billable or not, and is rounded to your chosen step (none, 5, 6, 10, 15 or 30 minutes).
- **Estimates and invoices** with their own numbers (`EST-0001`, `INV-0001`), line items, discount and tax. Add uninvoiced time and parts with one click.
- **Customer approval:** the customer signs an estimate on the screen (finger, pen or mouse); then turn the approved estimate into an invoice with one click.
- **Payments:** record full or partial payments (cash, card, transfer…). The repair is marked paid when its invoices are paid.
- **Printable invoices** with your logo, payment instructions and an optional payment link (for example a Stripe link with the amount filled in).
- **Billing page:** all estimates and invoices with filters for drafts, unpaid and overdue.

## Retainer clients

- **Contracts** with a monthly fee, included hours and an overage rate. A usage meter shows hours used this month.
- **Monthly invoices are created automatically** for each contract, including overage hours.
- **SLA targets:** response and resolution times by priority. Repairs show a countdown badge, the dashboard lists repairs at risk, and staff get a phone notification before a deadline is missed.
- **Recurring maintenance:** for example "Server health check, every 3 months". DBRepairs opens the repair on the due date and assigns it.
- **Reports:** revenue, hours, technician workload, turnaround and top customers, with charts. **CSV export** of invoices, payments and time in QuickBooks, Xero or plain format.

## Client records

- **Equipment (assets):** each customer's computers, servers and network gear with serial numbers, warranty dates and full repair history. Pick the equipment when you create a repair.
- **Network notes:** IP ranges, gateways, Wi-Fi, ISP and a list of devices for each customer.
- **Documents:** attach PDFs and images (contracts, network diagrams) to a customer.
- **Password vault:** customer logins stored encrypted. Every reveal is logged. Needs `VAULT_KEY`.
- **Intake:** a check-in checklist (power adapter, visible damage…), the customer's data-backup choice, a waiver, and the customer's signature, all printed on the intake sheet. A pickup signature is collected when the device goes home.
- **Data-wipe certificates** with method, standard, serial number and a printable certificate.
- **Activity log:** who changed what and when, on each repair and customer, and a full log for admins in Settings.

## Shop floor

- **Inventory:** parts on the shelf with quantity, reorder level, cost and price. Taking a part for a repair lowers the stock and adds it to the repair; removing it puts it back. Low-stock alerts on the dashboard.
- **Supplier returns (RMAs):** track a faulty part from *to ship* through *shipped* to *replaced*, *credited* or *rejected*.
- **Warranty comebacks:** open a new repair linked to the original one, marked as warranty.
- **Unclaimed devices:** a dashboard list of repairs ready for pickup for too long, with one-click email or SMS reminders.
- **Schedule:** a week view of on-site visits, pickups and appointments. Each person can add their schedule to their phone's calendar app.

## Communication

- **Email and SMS from the server** (SMTP and Twilio). Email and text buttons send directly when set up, and a copy of every message is kept on the repair and the customer. Without setup, buttons open your mail app as before.
- **Automatic messages** when a repair is booked in and when it is ready for pickup, with editable templates (Settings → Notifications).
- **Customer status page:** a private link per repair that shows its progress. It is printed on receipts and intake sheets. Published to the internet with Tailscale Funnel, which exposes only `/status`.
- **Phone notifications** for staff: assigned repairs, chat messages and SLA warnings (Settings → My account).

## Tools

- **Barcode scanning** with the phone or tablet camera: search repairs by their label, and find or take stock by barcode.
- **Checklists:** admins write step lists (for example a laptop diagnostic); technicians add them to a repair and tick each step. Who ticked it and when is saved.
- **Knowledge base:** searchable articles for known fixes and procedures. Related articles are suggested on each repair.
- **Off-site backups:** an optional `offsite` service copies database dumps and photos to cloud storage with rclone.

## Upgrading

1. `docker compose pull` (or `docker compose up -d --build` if you build from source), then `docker compose up -d`. The database is upgraded automatically; nothing is deleted.
2. On TrueNAS, change both `image:` lines to `0.7.0` and save.
3. Optional: add `VAULT_KEY`, email or SMS settings to `.env` and run `docker compose up -d` again. See `docker/README.md`.
4. Open **Settings → Billing** to set your currency, hourly rate and tax before creating the first invoice.
