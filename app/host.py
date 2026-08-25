"""Presses whichever button the crowd pressed most.

Start app/server.js first, then run this on the machine running the game. Each poll
takes the leading button and clears the counts, so a round covers exactly the time
since the previous poll.

Which key each button presses is decided by the server and edited at /admin.html, so
this only has to press whatever key it is handed.
"""

import asyncio
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from keypress import SUPPORTED_KEYS, make_presser
from src import GameClient, RequestError

# Either the address a browser would use or a ws:// one, since websocket_url converts it:
#   SERVER=https://your-app.onrender.com python app/host.py
SERVER = os.environ.get("SERVER", "https://tagdplays.onrender.com/")

POLL_INTERVAL = 3
# Games read the keyboard once a frame, so an instant press and release can fall between frames
HOLD_TIME = 0.05


def websocket_url(server):
    """Turn the address as a browser would show it into one a WebSocket can open.

    A deployed server is reached over TLS, and a plain ws:// attempt against it gets a
    redirect to TLS that WebSocket clients cannot follow.
    """
    for browser_scheme, socket_scheme in (("https://", "wss://"), ("http://", "ws://")):
        if server.startswith(browser_scheme):
            server = socket_scheme + server[len(browser_scheme):]
            break
    else:
        if "://" in server and not server.startswith(("ws://", "wss://")):
            raise ValueError(f"Cannot connect to {server}, expected an http, https, ws or wss URL")

    # A trailing slash becomes a request path the server has no WebSocket route for
    return server.rstrip("/")


async def press(presser, key):
    presser.down(key)
    await asyncio.sleep(HOLD_TIME)
    presser.up(key)


async def play(client, presser):
    while True:
        await asyncio.sleep(POLL_INTERVAL)

        try:
            result = await client.request("winner")
        except (RequestError, TimeoutError) as error:
            print(f"Could not read the input: {error}")
            continue

        if result is None:
            continue

        key = result["key"]

        # The mapping lives on the server and is edited from /admin.html, so a key this
        # build cannot press means the two have drifted apart
        if key not in SUPPORTED_KEYS:
            print(f"Server asked for key {key!r}, which this host cannot press")
            continue

        print(f"{result['input']} won {result['count']}/{result['total']}, pressing {key}")
        await press(presser, key)


async def main():
    url = websocket_url(SERVER)
    presser = make_presser()
    print(f"Pressing keys with the {presser.name} backend")
    print(f"Connecting to {url}")

    client = GameClient(url)

    @client.on_open
    def opened():
        print(f"Connected to {url}")

    @client.on_close
    def closed():
        print("Lost the server, reconnecting")

    try:
        async with client:
            await play(client, presser)
    finally:
        presser.close()


if __name__ == "__main__":
    # The client retries forever and only whispers about failures, which is
    # indistinguishable from a hang, so let it say why each attempt failed
    logging.basicConfig(format="%(message)s")
    logging.getLogger("src.game_client").setLevel(logging.DEBUG)

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nStopped")
