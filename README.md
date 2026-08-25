# game-networker

A minimal WebSocket game networking package. `GameServer` runs an HTTP server and a WebSocket
server on the same port, and serves the matching browser client itself, so there is no build
step or bundler on the client side. A [Python client](#python-client) is included too.

## Install

```bash
npm install game-networker
```

Requires Node 20.11 or newer. The package is ESM only.

## Server

```js
import path from "node:path";
import { GameServer } from "game-networker";

const gameServer = new GameServer({
    port: 3000,
    publicDir: path.join(import.meta.dirname, "public"),
});

gameServer.onConnection((client) => {
    client.send("welcome", { id: client.id });
});

gameServer.on("jump", (data, client) => {
    gameServer.broadcast("playerJumped", { id: client.id }, { except: client });
});

gameServer.start();
```

### Options

| Option | Default | Description |
| --- | --- | --- |
| `port` | `3000` | Port for the HTTP and WebSocket server. |
| `publicDir` | `null` | Directory of static files to serve. When omitted, only the client script and `/status` are served. |
| `clientRoute` | `"/gameClient.js"` | URL the browser client is served at. |
| `trustProxy` | `false` | Read the client address from the `x-forwarded-for` header. Enable only behind a reverse proxy you control. |

The server also answers `GET /status` with a plain-text health message.

Paths under `publicDir` are resolved and checked so a request cannot escape that directory.

### Handling messages

The server uses the same handler names as the browser client. Handlers receive the decoded
`data` plus the client that sent it.

| Method | Description |
| --- | --- |
| `on(type, handler)` | Calls `handler(data, client)` for each message with a matching `type`. Multiple handlers per type are allowed. |
| `onMessage(handler)` | Calls `handler({ type, data }, client)` for every message. |
| `onConnection(handler)` | Calls `handler(client)` when a client connects. |
| `onDisconnect(handler)` | Calls `handler(client)` when a client disconnects. |

Messages that are not valid JSON are ignored with a console warning, so a misbehaving client
cannot take the server down.

### Answering requests

Where `on` is fire-and-forget, `respond` answers a question. Whatever the responder returns is
sent back to the client that asked, and the client gets it as a resolved promise.

```js
let x = 0;

gameServer.on("button_pressed", () => { x++; });
gameServer.respond("x", () => x);
```

```js
const value = await gameClient.request("x");
```

Responders receive `(data, client)` just like `on` handlers, so they can answer per-player
questions such as `gameServer.respond("myScore", (data, client) => scores[client.id])`. A
responder may be `async` or return a promise; the reply is sent once it settles. If it throws,
the client's promise rejects with that error message.

One responder is registered per type, and registering the same type again replaces it.
Requests do not fire `on` or `onMessage` handlers.

### Sending messages

| Method | Description |
| --- | --- |
| `client.send(type, data)` | Sends to one client. Does nothing if that connection has already closed. |
| `broadcast(type, data, { except })` | Sends to every connected client, optionally skipping one. |
| `client.close()` | Disconnects that client. |

`gameServer.clients` is the `Set` of currently connected clients.

### Player ids

`client.id` is derived from the connection's IP address, so reloading the page or dropping the
connection gives a player the same id again. The address is hashed, because ids get sent to
other players and an address should not be. The raw address stays on the server as `client.ip`.

This is convenient, not authoritative. Be aware that:

- Players sharing a network share an id. Two people in the same house, office, or on the same
  mobile carrier will look like one player.
- **All connections from one machine share an id**, so several browser tabs on localhost are one
  player. This shows up immediately during local development.
- A player's id changes when their address does, such as moving between wifi and mobile.
- Anyone can get a new id with a VPN, so do not use this to enforce bans or ownership.

If you need identity that survives across networks and distinguishes people behind one router,
you need an account or a token stored in the browser instead.

If the server runs behind a reverse proxy, every connection appears to come from the proxy and
all players collapse onto one id. Set `trustProxy: true` so the address is read from
`x-forwarded-for`. Leave it off otherwise: the header is client-supplied, so trusting it when
there is no proxy lets a player pick their own id.

```js
gameServer.onDisconnect((client) => {
    gameServer.broadcast("playerLeft", { id: client.id });
    console.log(`${gameServer.clients.size} still connected`);
});
```

## Browser client

`GameClient` is served by `GameServer` at `clientRoute`, so import it by URL rather than
installing anything in the browser:

```html
<button id="sendBtn">Send Input</button>
<script type="module" src="/client.js"></script>
```

```js
// public/client.js
import GameClient from "/gameClient.js";

const gameClient = new GameClient();
gameClient.connect();

gameClient.addButton(document.getElementById("sendBtn"), "button_pressed");
gameClient.addKey("Space", "jump");

gameClient.on("playerMoved", (data) => {
    console.log(data.x, data.y);
});
```

### Wire format

Every message is JSON in the shape `{ "type": string, "data": any }`. The client encodes
outgoing messages and decodes incoming ones, so handlers receive the already-parsed `data`.
Incoming messages that are not valid JSON are ignored with a console warning.

### Sending

| Method | Description |
| --- | --- |
| `new GameClient(host, options)` | Opens a WebSocket to `host`, defaulting to `location.host`. Uses `wss://` on an HTTPS page and `ws://` otherwise. |
| `connect()` | Logs each time the connection opens. |
| `send(type, data)` | Sends `{ type, data }`. `data` defaults to `null`. |
| `request(type, data)` | Asks the server for a value and returns a promise. See [Requesting data](#requesting-data). |
| `close()` | Closes the connection and stops reconnecting. |

Calling `send` before the socket has opened is safe: the message is queued and flushed once the
connection is ready. The same applies while a dropped connection is being re-established.

### Reconnecting

If the connection drops, the client reconnects on its own. Handlers registered with `on`,
`onMessage`, `addButton` and friends carry over to the new connection, so nothing needs to be
re-registered.

| Option | Default | Description |
| --- | --- | --- |
| `reconnect` | `true` | Whether to reconnect after the connection closes. |
| `reconnectDelay` | `500` | Delay in ms before the first retry. |
| `maxReconnectDelay` | `10000` | Upper bound in ms for the delay. |

The delay doubles after each failed attempt up to `maxReconnectDelay`, and resets once a
connection succeeds. `close()` is treated as intentional and stops the retry loop.

```js
const gameClient = new GameClient(location.host, { reconnectDelay: 250 });

gameClient.onOpen(() => console.log("connected"));
gameClient.onClose(() => console.log("connection lost, retrying"));
```

| Method | Description |
| --- | --- |
| `onOpen(handler)` | Called on every successful connection, including reconnects. |
| `onClose(handler)` | Called whenever the connection drops. |

### Receiving

| Method | Description |
| --- | --- |
| `on(type, handler)` | Calls `handler(data)` for each message with a matching `type`. Multiple handlers per type are allowed. |
| `onMessage(handler)` | Calls `handler({ type, data })` for every message, whatever its type. |

### Requesting data

`on` and `onMessage` handle messages the server decides to send. To ask the server for
something instead, use `request`, which pairs with `respond` on the server:

```js
const x = await gameClient.request("x");
```

The promise resolves with whatever the server's responder returned, and rejects if the
responder threw, if no responder is registered for that type, or if no reply arrives within
`requestTimeout` (5000ms by default, set in the constructor options).

### Binding inputs

| Method | Description |
| --- | --- |
| `addInput(element, event, type, data)` | Sends on any DOM event, e.g. `addInput(el, "pointerdown", "shoot")`. |
| `addButton(element, type, data)` | Shorthand for a `click` binding. |
| `addKey(code, type, data)` | Sends when a key is pressed, matched on [`KeyboardEvent.code`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code) such as `"Space"` or `"KeyW"`. Auto-repeat from holding the key is ignored. |

These use `addEventListener`, so binding an input does not disturb handlers you have already
attached to the same element.

## Python client

`src/game_client.py` is an asyncio port of the browser client, for bots, tools and desktop
games. It speaks the same JSON envelope, so it connects to an unmodified `GameServer`.

```bash
pip install -r src/requirements.txt
```

There is no Python packaging, so import it by putting the repository root on `sys.path`:

```python
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import GameClient

async def main():
    client = GameClient("localhost:3000")

    @client.on("playerJoined")
    def joined(data):
        print(f"player {data['id']} joined")

    async with client:
        client.send("button_pressed")
        print("x is", await client.request("x"))

asyncio.run(main())
```

Register handlers before connecting. `connect()` and `async with` wait for the connection to
open, so anything the server sends on connect arrives before handlers added afterwards exist.

Everything the browser client does apart from the DOM bindings is here: the same message
envelope, queued sends, per-type and catch-all handlers, requests, automatic reconnection with
backoff, and `on_open` / `on_close`.

### Differences from the JavaScript client

| JavaScript | Python | Why |
| --- | --- | --- |
| `onMessage`, `sendMessage` | `on_message`, `send_message` | PEP 8 naming. |
| `reconnectDelay: 500` | `reconnect_delay=0.5` | Delays and timeouts are in seconds, as the rest of Python expects. |
| `new GameClient()` | `GameClient("localhost:3000")` | There is no page to infer the host from, so it is required. |
| `connect()` logs | `await client.connect()` | Actually opens the connection and waits for it. Use `async with` to connect and close around a block. |
| `wss://` inferred from the page | `GameClient(host, secure=True)` | Also accepts a full `ws://` or `wss://` URL as the host. |
| `addInput`, `addButton`, `addKey` | not present | These bind DOM events, which do not exist outside a browser. Call `send` from your own input handling. |
| Rejects with `Error` | Raises `RequestError` or `TimeoutError` | `RequestError` when the responder failed or is missing, `TimeoutError` when no reply arrived. |

Handlers may be plain functions or coroutines, and `on`, `on_message`, `on_open` and `on_close`
all return the handler, so they work as decorators.

## Example

The repository includes a runnable demo:

```bash
npm run example
```

Then open http://localhost:3000 and press the button. The server logs each message it receives.

With that server running, `python example/host.py` joins the same game from Python.

## License

MIT
