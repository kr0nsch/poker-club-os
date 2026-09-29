# Installing Poker Club OS in a venue

A step-by-step guide for the person who sets up the club: from unpacking the mini-PC to running the
first tournament. No enterprise networking knowledge is assumed. Plan about half a day, plus a test
evening before the first real tournament.

Throughout this guide the example club uses:

```text
Mini PC (edge server)
  Ubuntu Server 24.04 LTS, wired to the router
  Fixed address (DHCP reservation): 192.168.10.10

Router
  Staff Wi-Fi "Club-Staff"  → network 192.168.10.0/24
  Guest Wi-Fi "Club-Guest"  → network 192.168.20.0/24
  Local DNS: poker.royalclub.example → 192.168.10.10

Staff tablet:   connect to Club-Staff, open https://poker.royalclub.example
TV:             open https://poker.royalclub.example/display/<secret link>
Dealer tablet:  open https://poker.royalclub.example  (dealer account → dealer screen)
Kiosk tablet:   open https://poker.royalclub.example/kiosk/<secret link>
Players:        scan the QR code → https://poker.royalclub.example/p/royal
```

Replace the name `poker.royalclub.example` with a name under a domain your club owns.

## 1. What you need

| Item | Recommendation |
| --- | --- |
| Edge server | Mini-PC, 4+ CPU cores, 8–16 GB RAM, 256+ GB SSD, **wired** Gigabit Ethernet |
| UPS | Small UPS for the mini-PC, router and switch (15+ minutes) |
| Router | Can reserve IP addresses (DHCP reservation), add local DNS names, and run two Wi-Fi networks (staff and guest) — most business routers and OPNsense/pfSense/MikroTik/UniFi do |
| Wi-Fi | Access points covering the whole room; staff and guest networks separated |
| Staff devices | Tablets/phones for TD, floor and desk; one tablet per dealt table if dealers use it |
| Screens | TVs with a mini-PC or HDMI stick running a normal browser (Chrome/Chromium) |
| Kiosk | A tablet in a stand at the entrance; optionally a USB/Bluetooth QR scanner |
| Printer | For the QR code posters |

Place the edge server in a locked, ventilated spot (back office or rack), not in the gaming room.
Plug it, the router and the switch into the UPS.

## 2. Network and router

Do these once, in the router's admin page (or ask the network provider):

1. **Two Wi-Fi networks.** `Club-Staff` (strong WPA2/WPA3 password, only staff devices, TVs, kiosk)
   and `Club-Guest` (players, with *client isolation* switched on). If the router supports VLANs, put
   them in separate VLANs (e.g. 10 and 20).
2. **Fixed address for the edge server.** Connect the mini-PC by cable, find it in the router's list of
   connected devices and create a *DHCP reservation* so it always gets `192.168.10.10`.
3. **Local name.** Add a local DNS entry (called *host override*, *static DNS* or *local DNS record*):
   `poker.royalclub.example → 192.168.10.10`. Make sure devices get the router as their DNS server.
4. **Firewall rules on the router:**
   - Guest network → edge server: allow only TCP **443** and **80** (80 only redirects to 443). Block
     everything else from guests to the staff network (tablets, TVs, printers, the router's admin page).
   - Nothing from the Internet to the edge server: **no port forwarding**. The system needs no inbound
     connections; Telegram and cloud sync are outbound only.
   - Leave outbound Internet open for the edge server (Telegram, updates, off-site backups) — it is
     optional for running tournaments.
   - Do not expose the router's admin page, SSH, PostgreSQL (5432) or Redis (6379) to any Wi-Fi.
5. If a device cannot open the site by name, see *Pitfalls* in [LOCAL_NETWORK.md](LOCAL_NETWORK.md)
   (DNS-over-HTTPS in browsers, DNS rebind protection, captive portals).

## 3. Install the server software

On the mini-PC, install **Ubuntu Server 24.04 LTS** (default options, enable OpenSSH, create an
administrator user). Then, logged in as that user:

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker "$USER"   # log out and back in afterwards
git clone <repository-url> poker-club-os
cd poker-club-os
./deploy/scripts/install-edge.sh poker.royalclub.example
```

The install script creates `.env` with random secrets (`SESSION_SECRET`, database password,
`EDGE_NODE_ID`), writes the hostname into it, enables Docker at boot and starts all services:
PostgreSQL, Redis, API, worker, web app and the Caddy HTTPS proxy. All of them restart automatically
after a power cut.

Optional host firewall (recommended):

```bash
sudo ufw allow from 192.168.10.0/24 to any port 22 proto tcp   # SSH only from the staff network
sudo ufw allow 80,443/tcp                                      # the web app
sudo ufw enable
```

Keep a copy of `.env` in the club's password manager — it is needed to recover on a new machine (see
[BACKUP_RECOVERY.md](BACKUP_RECOVERY.md)).

## 4. HTTPS certificate

Browsers require HTTPS. Choose one:

- **A real certificate for your domain** (best when players use their own phones): obtain a
  certificate for `poker.royalclub.example` (for example with DNS validation at your DNS provider),
  copy `fullchain.pem` and `privkey.pem` to `deploy/certs/`, set
  `CADDY_TLS=/certs/fullchain.pem /certs/privkey.pem` in `.env` and run `docker compose up -d`.
- **Caddy's own certificate authority** (default): works immediately, but every staff device must
  trust Caddy's root certificate once — instructions in [DEVICE_SETUP.md](DEVICE_SETUP.md). Players'
  phones would need it too, so prefer a real certificate for guests.

## 5. First-run setup

1. On the server: `docker compose logs api | grep -A3 "FIRST-RUN SETUP"` shows a one-time setup token.
2. On a staff laptop connected to `Club-Staff`, open `https://poker.royalclub.example/setup`.
3. Enter the token, the club name and short name (used in player links, e.g. `royal`), the venue name,
   time zone and hostname, the edge server name, and the owner's e-mail and password.
4. You are signed in to **Admin**. Then:
   - **Settings**: language, currency, which features are on (online registration, kiosk, leagues…).
   - **Staff**: create a personal account for every TD, floor manager, desk/cashier and dealer.
   - **Structures**: check the default blind structure or build your own.

## 6. Devices

Follow [DEVICE_SETUP.md](DEVICE_SETUP.md). In short:

1. **Admin → Local network**: print the page. It has QR codes for the staff app, the player app and the
   admin, plus the IP address fallback.
2. **Staff tablets**: connect to `Club-Staff`, scan the staff QR, sign in with the personal account,
   add to home screen. Name each tablet in **Admin → Devices**.
3. **Dealer tablets**: sign in with a dealer account; in Admin → Devices assign each tablet to its table.
4. **TVs**: **Admin → Displays & kiosks → New display link**, open the link on the TV full-screen; add
   `?lang=ru` or `?lang=en` if needed.
5. **Kiosk**: create a kiosk link, open it on the entrance tablet, lock the tablet to that app
   (Guided Access / screen pinning), connect the QR scanner.
6. **Players**: put the player-app QR code on posters at the entrance, the desk and the tables.

## 7. Telegram (optional)

Create a bot with @BotFather and enter its token in **Admin → Telegram**. Players link their Telegram
account from the player app. The bot works whenever the club has Internet; tournaments never depend on
it. Details: [TELEGRAM.md](TELEGRAM.md).

## 8. Test evening (before the first real tournament)

Run a small practice tournament with staff as players:

1. Create a tournament, publish it, open registration.
2. Register players at the desk, from a phone (player app) and, if configured, from Telegram.
3. Check players in (desk and kiosk), draw seats, check the TV shows the seating, start the clock.
4. Eliminate a player from the floor tablet; undo it; report a bust from a dealer tablet.
5. **Unplug the Internet cable from the router.** Confirm that the clock, TVs, tablets, registration,
   seating and eliminations keep working and that staff see an "Internet unavailable" notice.
6. Plug it back in. Confirm the notice disappears and that queued Telegram messages arrive.
7. **Pull the power of the edge server** (simulating an outage), switch it on again: after about a
   minute everything is back, the clock shows the correct time and no action was lost.
8. Balance tables, break a table, finish the tournament, finalize results, check the league table.
9. **Admin → Health & backups → Run backup now**, and check a backup file appears.

## 9. Staff training checklist

- [ ] Sign in with your own account; never share accounts or tablets signed in as someone else.
- [ ] Desk: find/create a player, register, check in, re-entry/rebuy/add-on, print or show QR codes.
- [ ] Floor: clock controls, eliminations (several in one hand), undo, moving players, balancing,
      breaking tables, floor requests from dealers.
- [ ] Dealer: mark players present, report busts, confirm arriving players.
- [ ] TD: create tournaments from templates, late registration, finishing and finalizing.
- [ ] Everyone: what the connection indicators mean; that losing the Internet does not stop the game.

## 10. Go-live checklist

- [ ] Edge server wired, on the UPS, fixed IP, `docker compose ps` shows all services healthy.
- [ ] `https://poker.royalclub.example` opens without certificate warnings on every staff device.
- [ ] Guest Wi-Fi reaches only the player app; staff devices are not reachable from it.
- [ ] No port forwarding to the edge server on the router.
- [ ] Backups run (Admin → Health & backups) and an off-site copy is configured.
- [ ] `.env` stored safely; owner password in the password manager.
- [ ] Printed QR posters in place; TVs and kiosk started.
- [ ] Test evening completed, including the Internet unplug and the power cut.

## 11. When something goes wrong

| Problem | What to do |
| --- | --- |
| A tablet cannot open the site by name | Check it is on `Club-Staff`; try the IP fallback from the network page; check the router's local DNS entry; disable "secure DNS" in the browser |
| Certificate warning | The device does not trust Caddy's CA (install it) or the real certificate expired (renew and copy it to `deploy/certs/`) |
| "Internet unavailable" banner | Nothing to do for the game; Telegram and cloud sync resume by themselves when the Internet returns |
| Everything stopped working | Check the edge server has power and network; `docker compose ps`; `docker compose logs --tail=100 api worker`; restart with `docker compose restart` |
| A tablet was lost or stolen | Admin → Devices → Revoke; change that staff member's password |
| Wrong action during play | Use Undo in the floor console's history; every action is in Admin → Audit log |
| The edge server died | New mini-PC, same steps 3–4, restore `.env` and the newest backup: [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md) |

More detail: [LOCAL_NETWORK.md](LOCAL_NETWORK.md), [NETWORK_SECURITY.md](NETWORK_SECURITY.md),
[EDGE_DEPLOYMENT.md](EDGE_DEPLOYMENT.md), [OFFLINE_OPERATION.md](OFFLINE_OPERATION.md).
