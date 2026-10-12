# Homepage app downloads

The public homepage has an Android / App Store download band below the hero. Platform
administrators manage both links under **Platform → App download links** (`/admin/app-downloads`).
These are global platform settings; a shop Administrator cannot change the public homepage links.

Apply migration `10.57__bms_app_download_settings.sql` before using the configuration screen.
It creates one empty settings row and preserves configured links when re-applied.
No store listing or installer URL is supplied by default. Use an HTTPS Google Play / Android
installer URL and an HTTPS App Store URL when those downloads are ready.

Saving an empty field clears that destination. An unconfigured homepage badge is a native button
with no navigation: clicking or pressing Enter/Space leaves the current URL and scroll position
unchanged. A configured badge navigates to the saved URL in the same tab. A failed settings read
also leaves both buttons on the homepage. Settings reads are not cached; new page loads see updates.

Both admin REST methods authorize a platform administrator against the database. The write service
checks that authority again, validates both URLs before writing either, and records an audit action.
Only explicit `https://` URLs without embedded credentials, control characters or backslashes
are accepted (maximum 2,048 characters, also checked after URL encoding). Malformed forms such as
`https:example.com` are rejected instead of silently repaired into another destination. The public
read is rate-limited to 120 requests per minute per IP and returns only the two URLs, never the actor
or update metadata. On narrow screens, download badges wrap before their text can overflow.
All visible copy supports Thai
and English. No APK build, upload, App Store publication, or mobile application change is included.
