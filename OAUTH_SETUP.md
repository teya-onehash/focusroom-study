# Google OAuth production checklist

The browser starts Google sign-in through Supabase. No Google client secret belongs in `config.js`, `app.js`, GitHub Pages, or any other public asset.

## Google Cloud Console

In **Google Auth Platform → Branding**, use:

- App name: `Mellow Commons`
- Homepage: `https://joinfocusroomlive.live/`
- Privacy policy: `https://joinfocusroomlive.live/privacy.html`
- Terms of service: `https://joinfocusroomlive.live/terms.html`
- Authorized domain: `joinfocusroomlive.live`
- Logo: the square Mellow Commons mark from `assets/logo-mark.svg` (export a PNG if the console requests raster artwork)

Add an active support email and developer contact email controlled by the site owner. Keep the app name and logo identical to the website. Submit the consent screen for verification/publishing if Google requires it.

In the Google OAuth web client, use:

- Authorized JavaScript origin: `https://joinfocusroomlive.live`
- Authorized redirect URI: `https://fhexyiexginuzriwmfol.supabase.co/auth/v1/callback`

Do not add wildcard redirect URIs.

## Supabase Dashboard

In **Authentication → Providers → Google**, enable Google and add the client ID and client secret from Google Cloud. Store the secret only in the Supabase provider settings.

In **Authentication → URL Configuration**, set:

- Site URL: `https://joinfocusroomlive.live`
- Redirect URL: `https://joinfocusroomlive.live/**`

Retain a localhost redirect only if it is needed for trusted development. Test with a private browser window and confirm Google returns to the production domain with an authenticated session.
