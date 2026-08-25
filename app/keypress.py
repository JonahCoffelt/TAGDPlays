"""Presses keys on the machine running the game.

Injecting keystrokes is not portable, so there are two backends:

- ``uinput`` asks the kernel for a virtual keyboard through python-evdev. Every window
  sees it, including under Wayland, but it needs write access to /dev/uinput.
- ``pynput`` drives X11's XTEST extension, so it only reaches X11 and XWayland windows.

Key names are lowercase and mostly speak for themselves: "a", "5", "space", "enter",
"esc", "tab", "backspace", "shift", "ctrl", "alt", "up", "down", "left", "right".
"""

import string
import time

__all__ = ["make_presser", "BACKENDS", "SUPPORTED_KEYS"]

# Every key a mapping is allowed to name. Kept in step with KEYS in server.js, so the
# server can never hand back a key this cannot press.
SUPPORTED_KEYS = [
    *string.ascii_lowercase,
    *string.digits,
    "up", "down", "left", "right",
    "space", "enter", "esc", "tab", "backspace",
    "shift", "ctrl", "alt",
]

# evdev has no plain KEY_SHIFT, only sided ones, while pynput has no sided names
UINPUT_ALIASES = {"shift": "leftshift", "ctrl": "leftctrl", "alt": "leftalt"}

# A virtual keyboard is not usable the instant it is created: the compositor has to
# notice the new device first, and presses sent before then go nowhere
UINPUT_SETTLE_TIME = 0.5


class UinputPresser:
    name = "uinput"

    def __init__(self, keys):
        from evdev import UInput, ecodes

        self._ecodes = ecodes
        self._codes = {key: self._code(key) for key in keys}
        # Declaring only the keys we use keeps the virtual device honest about what it is
        self._device = UInput({ecodes.EV_KEY: list(self._codes.values())}, name="tagd-plays")
        time.sleep(UINPUT_SETTLE_TIME)

    def _code(self, key):
        name = UINPUT_ALIASES.get(key, key)
        code = self._ecodes.ecodes.get(f"KEY_{name.upper()}")

        if code is None:
            raise ValueError(f'No uinput key named "{key}"')

        return code

    def _write(self, key, value):
        self._device.write(self._ecodes.EV_KEY, self._codes[key], value)
        self._device.syn()

    def down(self, key):
        self._write(key, 1)

    def up(self, key):
        self._write(key, 0)

    def close(self):
        self._device.close()


class PynputPresser:
    name = "pynput"

    def __init__(self, keys):
        from pynput.keyboard import Controller, Key

        self._controller = Controller()
        # Single characters go through as themselves, named keys as members of Key
        self._keys = {key: Key[key] if key in Key.__members__ else key for key in keys}

    def down(self, key):
        self._controller.press(self._keys[key])

    def up(self, key):
        self._controller.release(self._keys[key])

    def close(self):
        pass


BACKENDS = {"uinput": UinputPresser, "pynput": PynputPresser}


def make_presser(keys=None, backend="auto"):
    """Return a presser for ``keys``, trying each backend in turn when set to "auto"."""
    keys = SUPPORTED_KEYS if keys is None else list(keys)

    if backend != "auto":
        if backend not in BACKENDS:
            raise ValueError(f'Unknown backend "{backend}", expected one of {", ".join(BACKENDS)}')

        return BACKENDS[backend](keys)

    failures = []

    for name, presser in BACKENDS.items():
        try:
            return presser(keys)
        except Exception as error:
            failures.append(f"{name}: {error}")

    raise RuntimeError("No keyboard backend worked:\n  " + "\n  ".join(failures))
