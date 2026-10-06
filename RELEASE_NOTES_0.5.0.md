# DBRepairs 0.5.0

DBRepairs now works like an app on phones and tablets.

## Install as an app (server edition)

- Add DBRepairs to the home screen on iPhone, iPad, Android or a computer. It opens full screen, without browser bars.
- The app icon is the shop logo. Icons are drawn from the logo when it is saved, including a padded "maskable" icon for Android and a solid-background icon for iOS. Logos saved before this version get icons the first time an admin opens Settings.
- The app name and status-bar color follow the company name and theme.
- A service worker caches the app's screens and styles, so it opens quickly. Customer data is never cached on the device.
- Long-press shortcuts: **New repair** and **Team chat**.
- Installing requires HTTPS, for example Tailscale Serve.

## Phone layout

- A compact top bar with the logo, and a bottom tab bar (Dashboard, Repairs, Customers, Parts, Team chat) with badges.
- Lists become stacked cards with labelled fields.
- Forms and dialogs open full screen; action menus open as bottom sheets.
- Larger tap targets. Inputs use 16 px text so iPhones do not zoom in.
- Content respects notches and the home indicator (safe areas).
