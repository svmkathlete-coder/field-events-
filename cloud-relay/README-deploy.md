# Deploying the cloud relay (do this once, before the meet)

This folder is a separate, standalone app from the main Field Events Bridge.
It needs to run somewhere reachable from the open internet (so judges on
mobile data can reach it), which your timing laptop usually isn't. You'll
deploy this one small folder to a free host — takes about 10 minutes.

Do this well before meet day, not the morning of — you need time to rehearse
it, same as everything else in this project.

**Correction:** an earlier version of this doc recommended Glitch. Glitch shut
down app hosting in mid-2025 — that option no longer exists, and any link to
`glitch.me` now redirects to their shutdown notice. Use Render below instead.

## Render.com (deploy from GitHub)

Render is currently the closest fit: a real, always-on Node process (not a
serverless function that forgets everything between requests, which would
break this relay's design), a free tier, and no ongoing charge as long as
you stay under its free limits — this app's traffic (small JSON messages a
few times a second) stays well inside them.

**Honest heads-up:** Render has recently been asking some sign-ups to verify
a card before creating a service, even on the free plan. Reports vary — some
accounts aren't asked, some are. You will **not** be charged for this
workload if you are asked and add one; it's used for verification, and
Render suspends (doesn't silently bill) a free service that exceeds its
limits. If you'd rather not enter a card anywhere, skip this whole feature —
local Wi-Fi/hotspot (already built and working) doesn't need any of this,
and you can instead put the effort into confirming the venue Wi-Fi reaches
the field, or positioning a hotspot centrally.

Steps:

1. Push this `cloud-relay` folder to GitHub — either as its own repo, or as
   a subfolder inside your existing project's repo. (No GitHub account? Make
   one free at https://github.com — you'll need it either way for Render to
   pull your code from.)
2. Go to https://render.com, sign up (free), click **New → Web Service**,
   and connect that GitHub repo.
3. If `cloud-relay` is a subfolder of a bigger repo, set **Root Directory**
   to `cloud-relay`.
4. Build command: `npm install`. Start command: `npm start`.
5. Under **Environment**, add a variable `SYNC_SECRET` with a long random
   value of your own choosing — this is NOT a judge's PIN, it's only ever
   typed once into your laptop's `config.js`.
6. Click **Create Web Service**. Render builds and deploys it — you'll get a
   URL like `https://your-app-name.onrender.com`.
7. Open `https://your-app-name.onrender.com/health` in a browser — you
   should see `{"success":true,...}`. That confirms it's live.
8. **Render's free tier spins down after 15 minutes with no traffic** and
   takes about a minute to wake back up on the next request. During the
   actual event this isn't a problem — your laptop's sync agent pings it
   every few seconds (`CLOUD_SYNC_INTERVAL_MS` in `config.js`), which keeps
   it awake the whole time you're running the server. The only slow moment
   is the very first request after it's been sitting idle for a while (e.g.
   the morning of the meet, before you've started your laptop's server for
   the day) — start your laptop's server a few minutes early so the relay is
   already awake before judges start submitting.

## After deploying (either option): point your laptop at it

Open the MAIN project's `config.js` (not this folder's) and set:

```js
CLOUD_RELAY_URL: 'https://your-app-name.onrender.com',   // your real URL, no trailing slash
CLOUD_SYNC_SECRET: 'pick-a-long-random-string-here',       // MUST match SYNC_SECRET above, exactly
```

Restart `node server.js` on the laptop. You should see in its console:

```
[Cloud Relay] Syncing with https://your-app-name.onrender.com every 4000ms
[Cloud Relay] Judges out of Wi-Fi range can use this URL on mobile data: https://your-app-name.onrender.com
```

Give judges who are out of Wi-Fi/hotspot range that URL instead of the local
`http://<laptop-ip>:3000` one. Everything else — their name, PIN, the event
list, entering marks — works identically; the only visible difference is
they'll briefly see "waiting for the timing laptop to confirm…" after
submitting, since their result has to travel through the relay and back
before it's final (usually a few seconds).

## Rehearse this before the meet, not during it

Test the full path once, deliberately: open the relay URL on a phone using
its mobile data (Wi-Fi turned OFF on the phone to be sure), submit a fake
result, and confirm it shows up as a real `.lff` file in your shared folder
and as "confirmed" on the phone. Do this from your actual venue if you can,
so you're testing real signal strength, not just that the code works.
