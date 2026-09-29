# Device setup

Every device in the venue — staff tablets and phones, dealer tablets, TVs, the entrance kiosk and the
players' own phones — is just a browser pointed at the edge server's local address. Nothing is
installed from an app store and nothing needs the Internet. This guide assumes the edge server is
running and reachable as `https://<venue hostname>` (see [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md)
and [LOCAL_NETWORK.md](LOCAL_NETWORK.md)).

Addresses and QR codes for all of them are on **Admin → Local network** (`/admin/network`); print that
page instead of typing addresses.

## 0. HTTPS certificate trust

The web app requires HTTPS (cookies are `Secure`, service workers and device ids need a secure
context). Two ways to get a certificate that devices accept:

| Option | Staff devices | Players' phones |
| --- | --- | --- |
| **Real domain certificate** (recommended when guests use the player app): a hostname under a domain the club owns, resolved to the edge server's LAN IP by the venue router, certificate obtained elsewhere (e.g. DNS-01) and copied to `deploy/certs/`, `CADDY_TLS="/certs/fullchain.pem /certs/privkey.pem"` | Works out of the box | Works out of the box |
| **Caddy's internal CA** (default, `CADDY_TLS=internal`) | Install the root certificate once per device (below) | Would require every guest to install a certificate — use the real-domain option for guests |

Export the internal root certificate:

```bash
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

Install it as a **trusted root** on each staff device:

| Platform | Steps |
| --- | --- |
| iPhone / iPad | AirDrop or e-mail `caddy-root.crt` → Settings → *Profile Downloaded* → Install; then Settings → General → About → **Certificate Trust Settings** → enable full trust |
| Android | Settings → Security → Encryption & credentials → **Install a certificate** → *CA certificate* → select the file |
| Windows | Double-click the file → Install Certificate → Local Machine → **Trusted Root Certification Authorities** |
| macOS | Open in Keychain Access → *System* keychain → certificate → Trust → **Always Trust** |
| Android TV / smart TVs | Usually no user CA support: use a small PC/stick with a normal browser, or the real-domain option |

If the Caddy data volume is lost, Caddy creates a new CA and devices must trust the new root.

## 1. Staff tablets and phones (desk, floor, TD)

1. Open `https://<hostname>/login` (QR "Staff app" on the network page) and sign in with the personal
   account an administrator created in **Admin → Staff**. Accounts are never shared.
2. The app opens the right home for the role: floor roles → `/floor`, dealers → `/dealer`, others →
   `/admin`.
3. Add it to the home screen (Share → *Add to Home Screen* on iOS, ⋮ → *Install app* on Android).
4. The browser generates a device id on first use and sends it with every request. The device appears
   in **Admin → Devices**, where an administrator can rename it ("Desk iPad 1"), set its type, mark it
   trusted, see who uses it and when it was last seen.

If a tablet is lost or stolen, **Revoke** it in Admin → Devices: its sessions end, its WebSocket is
closed and requests from it are refused (`DEVICE_REVOKED`) whoever signs in on it. **Restore** undoes
this. Also change the password of the staff member who was signed in.

The floor console keeps working through short Wi-Fi drops: it reconnects, reloads the tournament
snapshot and shows a connection banner meanwhile. Retrying an action after a network error (pressing
the button again in the same dialog) reuses its operation id, so it is never applied twice.

## 2. Dealer tablets

1. Create a dealer account (role **Dealer**) in Admin → Staff, sign in on the tablet: it opens
   `/dealer`, where the dealer picks the running tournament and the table.
2. Pin the tablet to its table: **Admin → Devices** → the tablet → *Assigned table*. An assigned dealer
   tablet can only act on that table.
3. The dealer screen shows the seats, lets the dealer mark players present, report a bust (the floor
   confirms the elimination), call the floor, and confirm players arriving from table moves.

## 3. TV displays

1. **Admin → Displays & kiosks → New display link**. Choose the venue, optionally a fixed tournament
   (otherwise the screen follows the venue's current tournament) and a template. The link
   `https://<hostname>/display/<secret>` is shown **once** — copy it or scan its QR code on the TV.
2. Open it full-screen in the TV's browser (double-click toggles full screen; the cursor hides after
   3 s). The page keeps the screen awake where the browser supports the Wake Lock API.
3. Pin a language with `?lang=ru` or `?lang=en` at the end of the link.
4. Templates (Admin → Displays & kiosks → Templates) choose the widgets (clock, blinds, next level,
   entries, remaining, average stack, announcements, seating, …), colours and a sponsor line. Seating
   pages appear only when the template includes the seating widget.
5. If the network drops, the TV keeps showing the last state with a red indicator and catches up by
   itself. To retire a TV, **Revoke** its link.

Recommended hardware: any mini-PC or HDMI stick with Chromium/Chrome in kiosk mode, e.g.
`chromium --kiosk --noerrdialogs --disable-session-crashed-bubble "https://<hostname>/display/<secret>?lang=ru"`.

## 4. Entrance kiosk (self check-in)

1. **Admin → Displays & kiosks → New kiosk link**; open `https://<hostname>/kiosk/<secret>` on a tablet
   in kiosk/guided-access mode (iOS *Guided Access*, Android *Screen pinning*).
2. Players check in with one of:
   - the **QR code** of their registration (from the player app): a USB/Bluetooth barcode scanner acting
     as a keyboard, or the tablet camera where the browser supports `BarcodeDetector`;
   - **member number + PIN** (PIN set by staff in the player profile; after 5 attempts for the same
     member number within 15 minutes further attempts are refused);
   - a **6-digit one-time code** shown in the player app (*Me*) or issued at the desk.
3. The kiosk shows the table and seat in large type, or sends the player to the cashier when the
   buy-in has not been paid (the kiosk never takes money). It resets after a few seconds.

## 5. Players' phones

1. Put the QR code **Player app** from Admin → Local network (or a tournament's QR from its admin page)
   on the tables, the registration desk and the TV.
2. Players open `https://<hostname>/p/<club>`, sign up or sign in, and can add the app to the home
   screen. They see tournaments, register or cancel, their check-in QR code, the live clock, their seat,
   results and league standings, and can link Telegram.
3. Guest Wi-Fi must be able to reach the edge server's HTTPS port but nothing else on the staff
   network (see [NETWORK_SECURITY.md](NETWORK_SECURITY.md)).

## 6. Quick checks

| Check | Expected |
| --- | --- |
| Staff tablet shows the green connection indicator | WebSocket connected to the edge |
| Pull the Internet cable | Staff see an "Internet unavailable" notice; clock, TV and floor keep working |
| Pause the clock on the floor console | TVs and player live pages pause within a second |
| Revoke a test device | It is signed out immediately |
