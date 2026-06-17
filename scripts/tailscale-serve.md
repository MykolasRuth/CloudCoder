# Exposing CloudCoder over Tailscale HTTPS

iOS needs a **secure context** (HTTPS) for the service worker and push
notifications. `tailscale serve` gives the app automatic TLS at your
machine's tailnet name.

## One-time setup

> **Important:** the Tailscale connection on this machine is owned by the
> interactive `mykol` user session — running serve commands from another
> account (e.g. an SSH session as `devserver`) returns
> `401 Unauthorized: Tailscale already in use`. Run these from a terminal
> inside the `mykol` desktop session, **or** first allow your user as
> operator (run once, as `mykol`, in an elevated terminal):
>
> ```
> tailscale set --operator=devserver
> ```

Then:

```
tailscale serve --bg 4060
```

That's it. The app is now at:

    https://your-pc.your-tailnet.ts.net

`--bg` makes the config persistent — it survives reboots; you don't need to
re-run it.

## Check / remove

```
tailscale serve status
tailscale serve reset     # remove all serve config
```

## Fallback without HTTPS

The app also listens on plain HTTP at:

    http://100.64.0.10:4060

Everything works there **except** the service worker, Add-to-Home-Screen
standalone mode, and push notifications (those need the HTTPS origin).

## Giving a dev server its own origin (rarely needed)

If some previewed app misbehaves behind the built-in port proxy, serve it on
an extra HTTPS port (serve supports 443/8443/10000):

```
tailscale serve --bg --https=8443 5173
```

→ `https://your-pc.your-tailnet.ts.net:8443`
