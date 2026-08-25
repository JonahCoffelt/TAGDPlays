"""Presses whichever button the crowd voted for.

Start app/server.js first, then run this on the machine running the game. Each poll
takes the winning button and clears the votes, so a round covers exactly the time
since the previous poll.
"""

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from keypress import make_presser
from src import GameClient, RequestError

# A deployed server needs the full wss:// URL, since a bare host would be plain ws://
# and hosts answer that with a redirect the client cannot follow:
#   SERVER=wss://your-app.onrender.com python app/host.py
SERVER = os.environ.get("SERVER", "localhost:3001")

# Which key on this machine each controller button presses
KEYS = {"A": "a", "B": "b"}

POLL_INTERVAL = 3
# Games read the keyboard once a frame, so an instant press and release can fall between frames
HOLD_TIME = 0.05


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
            print(f"Could not read the vote: {error}")
            continue

        if result is None:
            continue

        key = KEYS.get(result["button"])

        if key is None:
            print(f"No key mapped for button {result['button']}")
            continue

        print(f"{result['button']} won {result['count']}/{result['total']}, pressing {key}")
        await press(presser, key)


async def main():
    presser = make_presser(KEYS.values())
    print(f"Pressing keys with the {presser.name} backend")

    client = GameClient(SERVER)

    @client.on_open
    def opened():
        print(f"Connected to {SERVER}")

    @client.on_close
    def closed():
        print("Lost the server, reconnecting")

    try:
        async with client:
            await play(client, presser)
    finally:
        presser.close()


try:
    asyncio.run(main())
except KeyboardInterrupt:
    print("\nStopped")
