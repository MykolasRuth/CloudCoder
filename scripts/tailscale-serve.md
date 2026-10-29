# Exposing CloudCoder over Tailscale HTTPS

CloudCoder listens on `127.0.0.1:4060` only, so nothing on the home LAN can
reach it. `tailscale serve` is the way in: it answers only devices on your
tailnet and gives the app automatic TLS at the Mac mini's tailnet name. iOS
needs that HTTPS origin (a **secure context**) for the service worker and
push notifications.

## One-time setup

On the Mac mini (`ssh your-mac`):

```
tailscale serve --bg --https=443 http://127.0.0.1:4060
```

That's it. The app is now at:

    https://your-mac.your-tailnet.ts.net

`--bg` makes the config persistent — it survives reboots; you don't need to
re-run it.

If the command prints a `login.tailscale.com` link and waits, HTTPS
certificates aren't enabled for the tailnet yet: open the link, enable them,
then run the command again.

Port 8443 on this machine is Agent Deck's
(`https://your-mac.your-tailnet.ts.net:8443`), so leave that mapping alone.

## Only your Tailscale login (optional)

`tailscale serve` adds a `Tailscale-User-Login` header to every request it
proxies. With `CLOUDCODER_ALLOWED_LOGINS` set (comma-separated), CloudCoder
refuses any request or websocket without one of those logins, including
requests that skip Serve and hit `127.0.0.1:4060` directly. Reinstall the
LaunchAgent with it set so it sticks:

```
CLOUDCODER_ALLOWED_LOGINS=you@github ./scripts/start.sh --install
```

`tailscale whois <device-tailnet-ip>` shows a device's login under `User`.

## Check / remove

```
tailscale serve status
tailscale serve --https=443 off   # remove just CloudCoder's mapping
tailscale serve reset             # remove ALL serve config, Agent Deck's too
```

## Listening on the LAN again (not recommended)

`CLOUDCODER_HOST=0.0.0.0` makes the server listen on every interface over
plain HTTP. Anyone on the network can then open a Claude Code terminal on
this machine unless `CLOUDCODER_PIN` is set. Without HTTPS the service
worker, Add-to-Home-Screen standalone mode and push notifications don't work
either.

## Giving a dev server its own origin (rarely needed)

If some previewed app misbehaves behind the built-in port proxy, serve it on
the spare HTTPS port. Serve supports 443/8443/10000, and 443 and 8443 are
taken here:

```
tailscale serve --bg --https=10000 http://127.0.0.1:5173
```

→ `https://your-mac.your-tailnet.ts.net:10000`
