"""Presses keys on the machine running the game.

Which backend is used depends on the OS, because injecting keystrokes is not portable:

- Linux: ``uinput`` (a virtual keyboard the kernel exposes; works under Wayland) then
  ``pynput`` (X11 / XWayland only).
- Windows: ``sendinput`` (Win32 SendInput) then ``pynput``.
- macOS: ``quartz`` (CGEvent) then ``pynput``. macOS will silently ignore both until
  Terminal (or the Python app) is allowed in System Settings > Privacy & Security >
  Accessibility.

Override the choice with KEYBOARD_BACKEND=uinput|sendinput|quartz|pynput.

Key names are lowercase: "a", "5", "space", "enter", "esc", "tab", "backspace",
"shift", "ctrl", "alt", "up", "down", "left", "right".
"""

import ctypes
import string
import sys
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

# Carbon virtual key codes, which are not ASCII. From HIToolbox/Events.h.
MAC_KEYCODES = {
    "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05,
    "z": 0x06, "x": 0x07, "c": 0x08, "v": 0x09, "b": 0x0B,
    "q": 0x0C, "w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10, "t": 0x11,
    "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15, "6": 0x16, "5": 0x17,
    "9": 0x19, "7": 0x1A, "8": 0x1C, "0": 0x1D,
    "o": 0x1F, "u": 0x20, "i": 0x22, "p": 0x23,
    "l": 0x25, "j": 0x26, "k": 0x28, "n": 0x2D, "m": 0x2E,
    "enter": 0x24, "tab": 0x30, "space": 0x31, "backspace": 0x33, "esc": 0x35,
    "shift": 0x38, "alt": 0x3A, "ctrl": 0x3B,
    "left": 0x7B, "right": 0x7C, "down": 0x7D, "up": 0x7E,
}

# Win32 virtual-key codes. Letters and digits match their uppercase ASCII values.
WIN_VKS = {
    **{letter: ord(letter.upper()) for letter in string.ascii_lowercase},
    **{digit: ord(digit) for digit in string.digits},
    "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28,
    "backspace": 0x08, "tab": 0x09, "enter": 0x0D, "shift": 0x10,
    "ctrl": 0x11, "alt": 0x12, "esc": 0x1B, "space": 0x20,
}

# Arrow keys are extended: SendInput has to set KEYEVENTF_EXTENDEDKEY or they
# arrive as numpad arrows instead
WIN_EXTENDED = {0x25, 0x26, 0x27, 0x28}


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


class SendInputPresser:
    """Win32 SendInput. No extra packages; games see it as a real key."""

    name = "sendinput"

    def __init__(self, keys):
        if sys.platform != "win32":
            raise RuntimeError("sendinput is Windows-only")

        from ctypes import wintypes

        self._vks = {key: WIN_VKS[key] for key in keys}
        self._user32 = ctypes.WinDLL("user32", use_last_error=True)

        class KeyBdInput(ctypes.Structure):
            _fields_ = (
                ("wVk", wintypes.WORD),
                ("wScan", wintypes.WORD),
                ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD),
                ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG)),
            )

        class HardwareInput(ctypes.Structure):
            _fields_ = (
                ("uMsg", wintypes.DWORD),
                ("wParamL", wintypes.WORD),
                ("wParamH", wintypes.WORD),
            )

        class MouseInput(ctypes.Structure):
            _fields_ = (
                ("dx", wintypes.LONG),
                ("dy", wintypes.LONG),
                ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD),
                ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG)),
            )

        class InputUnion(ctypes.Union):
            _fields_ = (("ki", KeyBdInput), ("mi", MouseInput), ("hi", HardwareInput))

        class Input(ctypes.Structure):
            _fields_ = (("type", wintypes.DWORD), ("union", InputUnion))

        self._KeyBdInput = KeyBdInput
        self._Input = Input
        self._InputUnion = InputUnion
        self._user32.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(Input), ctypes.c_int)
        self._user32.SendInput.restype = wintypes.UINT
        self._user32.MapVirtualKeyW.argtypes = (wintypes.UINT, wintypes.UINT)
        self._user32.MapVirtualKeyW.restype = wintypes.UINT

    def _send(self, key, up):
        vk = self._vks[key]
        scan = self._user32.MapVirtualKeyW(vk, 0)
        # Scan codes rather than virtual keys, because a lot of games ignore the latter
        flags = 0x0008  # KEYEVENTF_SCANCODE
        if vk in WIN_EXTENDED:
            flags |= 0x0001  # KEYEVENTF_EXTENDEDKEY
        if up:
            flags |= 0x0002  # KEYEVENTF_KEYUP

        payload = self._InputUnion(ki=self._KeyBdInput(0, scan, flags, 0, None))
        event = self._Input(1, payload)  # INPUT_KEYBOARD
        sent = self._user32.SendInput(1, ctypes.byref(event), ctypes.sizeof(event))

        if sent != 1:
            raise ctypes.WinError(ctypes.get_last_error())

    def down(self, key):
        self._send(key, up=False)

    def up(self, key):
        self._send(key, up=True)

    def close(self):
        pass


class QuartzPresser:
    """macOS CGEvent. Needs Accessibility permission for the hosting terminal."""

    name = "quartz"
    hint = (
        "If keys do not reach the game, allow Terminal (or your Python app) in "
        "System Settings > Privacy & Security > Accessibility"
    )

    def __init__(self, keys):
        if sys.platform != "darwin":
            raise RuntimeError("quartz is macOS-only")

        self._codes = {key: MAC_KEYCODES[key] for key in keys}

        core = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
        foundation = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")

        core.CGEventSourceCreate.argtypes = [ctypes.c_uint32]
        core.CGEventSourceCreate.restype = ctypes.c_void_p
        core.CGEventCreateKeyboardEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint16, ctypes.c_bool]
        core.CGEventCreateKeyboardEvent.restype = ctypes.c_void_p
        core.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
        core.CGEventPost.restype = None
        foundation.CFRelease.argtypes = [ctypes.c_void_p]
        foundation.CFRelease.restype = None

        # HID system state, so the event looks like it came from a real keyboard
        source = core.CGEventSourceCreate(1)
        if not source:
            raise RuntimeError("CGEventSourceCreate failed")

        self._core = core
        self._foundation = foundation
        self._source = source

        if not _macos_trusted():
            print(self.hint)

    def _send(self, key, down):
        event = self._core.CGEventCreateKeyboardEvent(self._source, self._codes[key], down)
        if not event:
            raise RuntimeError("CGEventCreateKeyboardEvent failed")
        try:
            self._core.CGEventPost(0, event)  # kCGHIDEventTap
        finally:
            self._foundation.CFRelease(event)

    def down(self, key):
        self._send(key, True)

    def up(self, key):
        self._send(key, False)

    def close(self):
        if self._source:
            self._foundation.CFRelease(self._source)
            self._source = None


class PynputPresser:
    name = "pynput"

    def __init__(self, keys):
        from pynput.keyboard import Controller, Key

        self._controller = Controller()
        # Single characters go through as themselves, named keys as members of Key
        self._keys = {key: Key[key] if key in Key.__members__ else key for key in keys}

        if sys.platform == "darwin":
            self.hint = QuartzPresser.hint
            if not _macos_trusted():
                print(self.hint)

    def down(self, key):
        self._controller.press(self._keys[key])

    def up(self, key):
        self._controller.release(self._keys[key])

    def close(self):
        pass


BACKENDS = {
    "uinput": UinputPresser,
    "sendinput": SendInputPresser,
    "quartz": QuartzPresser,
    "pynput": PynputPresser,
}


def _macos_trusted():
    try:
        lib = ctypes.cdll.LoadLibrary(
            "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
        )
        lib.AXIsProcessTrusted.restype = ctypes.c_bool
        lib.AXIsProcessTrusted.argtypes = []
        return bool(lib.AXIsProcessTrusted())
    except Exception:
        return True


def backends_for(platform=sys.platform):
    """Native backend first, pynput as a portable fallback."""
    if platform.startswith("linux"):
        return ("uinput", "pynput")
    if platform == "darwin":
        return ("quartz", "pynput")
    if platform.startswith("win"):
        return ("sendinput", "pynput")
    return ("pynput",)


def make_presser(keys=None, backend="auto"):
    """Return a presser for ``keys``, trying each backend in turn when set to "auto"."""
    keys = SUPPORTED_KEYS if keys is None else list(keys)
    missing = [key for key in keys if key not in SUPPORTED_KEYS]
    if missing:
        raise ValueError(f"Unknown key names: {', '.join(missing)}")

    if backend != "auto":
        if backend not in BACKENDS:
            raise ValueError(f'Unknown backend "{backend}", expected one of {", ".join(BACKENDS)}')

        return BACKENDS[backend](keys)

    failures = []

    for name in backends_for():
        try:
            return BACKENDS[name](keys)
        except Exception as error:
            failures.append(f"{name}: {error}")

    raise RuntimeError("No keyboard backend worked:\n  " + "\n  ".join(failures))
