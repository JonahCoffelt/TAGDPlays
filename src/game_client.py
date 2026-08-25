"""Python port of the browser GameClient, for writing bots and desktop clients.

Speaks the same JSON envelope as the JavaScript client, so it talks to an
unmodified GameServer.
"""

import asyncio
import inspect
import json
import logging
from collections import deque
from contextlib import suppress

import websockets

__all__ = ["GameClient", "RequestError"]

logger = logging.getLogger(__name__)


class RequestError(Exception):
    """Raised when the server refuses or fails to answer a request."""


class GameClient:
    def __init__(
        self,
        host,
        *,
        secure=False,
        reconnect=True,
        reconnect_delay=0.5,
        max_reconnect_delay=10.0,
        request_timeout=5.0,
    ):
        self.url = host if "://" in host else f"{'wss' if secure else 'ws'}://{host}"
        self.reconnect = reconnect
        self.reconnect_delay = reconnect_delay
        self.max_reconnect_delay = max_reconnect_delay
        self.request_timeout = request_timeout

        self._type_handlers = {}
        self._message_handlers = []
        self._open_handlers = []
        self._close_handlers = []

        self._pending = deque()
        self._pending_requests = {}
        self._next_request_id = 1

        self._socket = None
        self._task = None
        self._stopped = False
        self._retry_delay = reconnect_delay
        self._writable = asyncio.Event()
        self._connected = asyncio.Event()

    async def connect(self):
        """Start connecting and wait until the connection is open."""
        if self._task is None:
            self._stopped = False
            self._task = asyncio.create_task(self._run())

        await self._connected.wait()

    async def close(self):
        """Close the connection and stop reconnecting."""
        self._stopped = True
        self._writable.set()

        if self._socket is not None:
            await self._socket.close()

        if self._task is not None:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
            self._task = None

        for future in self._pending_requests.values():
            if not future.done():
                future.set_exception(RequestError("Connection closed"))
        self._pending_requests.clear()

    def send(self, message_type, data=None):
        """Queue a message. Never blocks, even while disconnected."""
        self.send_message({"type": message_type, "data": data})

    async def request(self, message_type, data=None):
        """Ask the server for a value and wait for its reply."""
        request_id = self._next_request_id
        self._next_request_id += 1

        future = asyncio.get_running_loop().create_future()
        self._pending_requests[request_id] = future
        self.send_message({"type": message_type, "data": data, "requestId": request_id})

        try:
            return await asyncio.wait_for(future, self.request_timeout)
        except asyncio.TimeoutError:
            raise TimeoutError(f'Request "{message_type}" timed out') from None
        finally:
            self._pending_requests.pop(request_id, None)

    def send_message(self, message):
        self._pending.append(json.dumps(message))
        self._writable.set()

    def on(self, message_type, handler=None):
        """Register a handler for one message type. Also usable as a decorator."""
        def register(handler):
            self._type_handlers.setdefault(message_type, []).append(handler)
            return handler

        return register if handler is None else register(handler)

    def on_message(self, handler):
        self._message_handlers.append(handler)
        return handler

    def on_open(self, handler):
        self._open_handlers.append(handler)
        return handler

    def on_close(self, handler):
        self._close_handlers.append(handler)
        return handler

    async def handle_message(self, raw):
        try:
            message = json.loads(raw)
        except (json.JSONDecodeError, TypeError, ValueError):
            logger.warning("Ignoring message that is not valid JSON: %s", raw)
            return

        if not isinstance(message, dict):
            logger.warning("Ignoring message that is not an object: %s", raw)
            return

        future = self._pending_requests.pop(message.get("requestId"), None)

        if future is not None:
            if not future.done():
                if message.get("error"):
                    future.set_exception(RequestError(message["error"]))
                else:
                    future.set_result(message.get("data"))
            return

        await self._fire(self._message_handlers, message)
        await self._fire(self._type_handlers.get(message.get("type"), []), message.get("data"))

    async def _run(self):
        while not self._stopped:
            try:
                async with websockets.connect(self.url) as socket:
                    self._socket = socket
                    self._retry_delay = self.reconnect_delay
                    self._connected.set()
                    self._writable.set()
                    await self._fire(self._open_handlers)
                    await self._read(socket)
            except Exception as error:
                logger.debug("Connection to %s ended: %s", self.url, error)
            finally:
                self._socket = None
                self._connected.clear()
                await self._fire(self._close_handlers)

            if self._stopped or not self.reconnect:
                break

            await asyncio.sleep(self._retry_delay)
            # Back off so a server that stays down is not hammered
            self._retry_delay = min(self._retry_delay * 2, self.max_reconnect_delay)

    async def _read(self, socket):
        writer = asyncio.create_task(self._write(socket))

        try:
            async for raw in socket:
                await self.handle_message(raw)
        finally:
            writer.cancel()
            with suppress(asyncio.CancelledError):
                await writer

    async def _write(self, socket):
        while True:
            if not self._pending:
                self._writable.clear()
                await self._writable.wait()
                continue

            # Left on the queue until the send succeeds, so nothing is lost on a drop
            await socket.send(self._pending[0])
            self._pending.popleft()

    async def _fire(self, handlers, *args):
        for handler in handlers:
            result = handler(*args)

            if inspect.isawaitable(result):
                await result

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, *exc_info):
        await self.close()
