# DBRepairs 0.4.0

A redesigned interface plus the features an electronics repair shop needs every day.

## Interface

- New flat design (shadcn-style) with HubSpot's colors by default: thin borders, no gradients.
- Settings → Appearance changes every color, the body and heading fonts and the corner roundness, with a live preview and presets.
- The sidebar collapses to icons, and long company names no longer get cut off.
- The company logo now saves as soon as it is chosen (large photos are resized automatically). It appears in the sidebar, the browser tab icon, the sign-in page and every ticket.
- Pages have their own addresses (`#/repairs/12`), so the browser back button and bookmarks work.

## Repairs

- Repairs can be deleted from the list or the repair page.
- New repair page with priority, promised date (overdue repairs are flagged), technician, deposit, paid, warranty and balance due.
- Parts to order: part, number, supplier, order link, quantity, cost and status. The new Parts page lists everything still to order across all repairs.
- Email the customer from ready-made templates (received, estimate, waiting for parts, ready, thank you).

## Printing

- Device label with a Code 128 barcode, an 80 mm customer receipt and the A4 intake sheet.
- Optional automatic printing right after a repair is created.
- Printable terms text on customer copies.
- Scanning a label in the repairs search opens the repair.

## Customers

- Full profiles: residential or commercial, contact person, mobile, preferred contact, tags, and retainer plan, fee and renewal date.
- Profile page with repair history, open repairs, total billed and last visit.
- Email, call and text links.

## Server edition

- Personal sign-ins with admin and tech roles (Settings → Team). The `admin` account uses `DBREPAIRS_PASSWORD`.
- Team chat: one channel with tags, open-question tracking, attachments, and clickable links and repair numbers.
- Dashboard cards for overdue repairs and parts to order.

## Data

- Portable backups move to format version 2 (profiles and parts included). Version 1 files still restore.
- Desktop: deleting a repair also removes its parts and history in one transaction.

**Upgrading:** sign in with the username `admin` and your existing password. Database changes apply automatically on start.
