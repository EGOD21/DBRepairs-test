# DBRepairs 0.5.1

## Fixes

- **The installed app had no icon.** nginx answered every address ending in `.png` from its own files, so the app icons under `/api/app/` returned "not found". `/api/` requests now always go to the API. CI now starts the real web image and checks this routing.
- **Large logos could fail to save their app icons.** Saving a logo with its four icons could exceed the 3.2 MB request limit; settings now accept up to 16 MB.
- **iPhone/iPad:** the home-screen icon link is now in the page itself, where Safari looks for it.

After updating, remove the app from the home screen and add it again so the phone picks up the icon.
