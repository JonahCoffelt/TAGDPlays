# tagd-plays

Crowd-controlled keyboard inspired by DougDoug's Twitch Plays. Phones get a controller, pick a team, and send button inputs. The host machine presses the most pressed buttons from each team.


## Prerequisites
Needs Node 20.11+ and Python 3.10+.

## Quick start

```bash
npm install
python3 -m venv .venv

# Windows
.venv\Scripts\pip
# Linux/Mac
.venv/bin/pip install -r app/requirements.txt

npm start
```

The server prints a `trycloudflare.com` URL and writes `qr.png`. Phones open that URL. On the same machine as the game:

```bash
.venv/bin/python app/host.py https://….trycloudflare.com
```

The URL is new every time you start the server. If you restart the server, you will need to give users the new link or QR code. 

On macOS, allow Terminal/Python under System Settings → Privacy & Security → Accessibility so `host.py` can press keys.

## Use

- **Phone Players** — Scan `qr.png`, pick a team, then use the controller.
- **Host page** — `https://….trycloudflare.com/admin.html`. Map buttons to keys, save/load layouts, pause inputs, or reset teams. It is recomended to pause inputs rather than kill the server to avoid needing to redistribute the QR code. 
- **Team images** — Replace `app/public/teams/one.png` and `two.png`.

Set `ADMIN_KEY` before sharing the link if you do not want anyone accessing the admin page:

```bash
ADMIN_KEY=secret npm start
```