# LuckyNeko Cloudflare Tunnel Deployment

This app is set up to run locally on port `3200` and be exposed through the existing Cloudflare Tunnel on this Mac.

## What is already done

- Production build succeeds with `npm run build`.
- DNS record created for `luckyneko.cozorohome.com`.
- Launch agent template added at `deploy/launchd/com.luckyneko.app.plist`.
- Private user media, including generated category icons under `/api/media/...`, is served behind authentication. If you render those URLs in Next.js, bypass `next/image` optimization or use a plain `<img>` so the optimizer does not fetch them without a session cookie.

## One-time app setup

1. Create a local env file:

   ```bash
   cp .env.example .env.local
   ```

2. Edit `.env.local` and set:

   ```env
   GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
   ```

   If you are using 9router for fallback or structured-model routing, you can also set:

   ```env
   NINE_ROUTER_API_KEY=your_key_here
   NINE_ROUTER_MINI_MODEL=gpt-5
   NINE_ROUTER_MODEL=gpt-5
   ```

   The admin portal can override both 9router model fields at runtime. The first-pass model is used for easier chat queries and structured cleanup flows by default.

3. Build the app:

   ```bash
   npm run build
   ```

## Run the app on boot with launchd

1. Install the launch agent:

   ```bash
   mkdir -p ~/Library/Logs
   cp deploy/launchd/com.luckyneko.app.plist ~/Library/LaunchAgents/com.luckyneko.app.plist
   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.luckyneko.app.plist 2>/dev/null || true
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.luckyneko.app.plist
   launchctl enable gui/$(id -u)/com.luckyneko.app
   launchctl kickstart -k gui/$(id -u)/com.luckyneko.app
   ```

2. Check the app locally:

   ```bash
   curl -I http://127.0.0.1:3200
   ```

3. Check logs if needed:

   ```bash
   tail -f ~/Library/Logs/luckyneko-app.log
   tail -f ~/Library/Logs/luckyneko-app-error.log
   ```

Note:
If macOS refuses to start the LaunchAgent when the project lives under `~/Desktop`, move the repo to a normal development folder such as `~/Projects/luckynekoAI`, then update the absolute paths in `scripts/run-production.sh` and `deploy/launchd/com.luckyneko.app.plist`.

## Cloudflare dashboard step you still need

This computer's main tunnel is running in **remotely-managed** mode, so the hostname-to-service mapping is controlled in Cloudflare's dashboard, not in `~/.cloudflared/config.yml`.

In Cloudflare, go to:

`Cloudflare Dashboard -> Networking -> Tunnels -> cozorohome-portal -> Routes -> Add route`

Then enter:

- Route type: `Published application`
- Hostname: `luckyneko`
- Domain: `cozorohome.com`
- Service: `HTTP`
- URL: `http://localhost:3200`

Save the route.

If Cloudflare warns that the DNS record already exists, that is expected because the DNS record was created from this machine already.

## How DNS works here

Cloudflare Tunnel uses a CNAME record that points your hostname to the tunnel. For this app, the hostname is:

`luckyneko.cozorohome.com`

The DNS record can also be created from CLI with:

```bash
cloudflared tunnel route dns ace69517-369e-44a3-9f00-3304bf2153df luckyneko.cozorohome.com
```

That step is already complete.

## Verify from the Internet

After the dashboard route is added and the app is running:

```bash
curl -I https://luckyneko.cozorohome.com
```

If you get a `1016` error, DNS exists but the tunnel route is not fully configured in Cloudflare yet.
