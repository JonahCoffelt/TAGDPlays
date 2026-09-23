"""Presses whichever buttons each team pressed most.

Start the server first (`npm start`). It prints a trycloudflare.com URL and writes
qr.png. Run this on the machine running the game and pass that URL:

    python app/host.py https://….trycloudflare.com

Every team is counted separately. Each poll takes that team's top two inputs (or one,
if only one button was pressed) and holds those keys together, so a round covers
exactly the time since the previous poll.

Which key each team's buttons press is decided by the server and edited at
/admin.html, so this only has to press whatever keys it is handed.
"""

import asyncio
import logging
import os
import sys
from pathlib import Path

# The client package lives in src/. `pip install -e .` puts the same package on the
# path; this keeps `python app/host.py` working without that install.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from game_networker import GameClient, RequestError
from keypress import SUPPORTED_KEYS, make_presser

# Force a backend with KEYBOARD_BACKEND=uinput|sendinput|quartz|pynput
KEYBOARD_BACKEND = os.environ.get("KEYBOARD_BACKEND", "auto")

POLL_INTERVAL = 0.25
# Games read the keyboard once a frame, so an instant press and release can fall between frames
HOLD_TIME = 0.3


def server_url():
    """The public URL the server printed. It is different every time the server starts."""
    url = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("SERVER", "")
    url = url.strip()

    if not url:
        raise SystemExit(
            "Pass the URL the server printed:\n"
            "  python app/host.py https://….trycloudflare.com"
        )

    return url


async def press(presser, keys):
    """Hold every key down together, so both teams — and a team's top two — act at once."""
    # The same key from two picks is still one press, and pressing it twice would
    # leave the second release lifting a key that is already up
    keys = list(dict.fromkeys(keys))

    for key in keys:
        presser.down(key)

    await asyncio.sleep(HOLD_TIME)

    for key in reversed(keys):
        presser.up(key)


def keys_from(results):
    keys = []

    for team, result in sorted(results.items()):
        if team == "sending" or not isinstance(result, dict):
            continue

        picks = result.get("picks") or []
        chosen = []

        for pick in picks:
            key = pick.get("key")

            # The mappings live on the server and are edited from /admin.html, so a key this
            # build cannot press means the two have drifted apart
            if key not in SUPPORTED_KEYS:
                print(f"Team {team} asked for key {key!r}, which this host cannot press")
                continue

            chosen.append((pick["input"], pick["count"], key))

        if not chosen:
            continue

        print(
            f"Team {team}: "
            + " + ".join(f"{input} ({count})" for input, count, _ in chosen)
            + f" of {result['total']}, pressing "
            + "+".join(key for _, _, key in chosen)
        )
        keys.extend(key for _, _, key in chosen)

    return keys


async def play(client, presser):
    sending = True

    while True:
        await asyncio.sleep(POLL_INTERVAL)

        try:
            results = await client.request("winner")
        except (RequestError, TimeoutError) as error:
            print(f"Could not read the inputs: {error}")
            continue

        now_sending = results.get("sending", True)

        if now_sending != sending:
            sending = now_sending
            print("Input sending is on" if sending else "Input sending is off")

        if not sending:
            continue

        keys = keys_from(results)

        if keys:
            await press(presser, keys)


async def main():
    url = server_url()
    presser = make_presser(backend=KEYBOARD_BACKEND)
    print(f"Pressing keys with the {presser.name} backend on {sys.platform}")
    if getattr(presser, "hint", None):
        print(presser.hint)
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
    logging.getLogger("game_networker.game_client").setLevel(logging.DEBUG)

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nStopped")
