import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { WebSocket, WebSocketServer } from "ws"

const CONTENT_TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
}

class ConnectedClient {
    constructor(id, ip, socket) {
        this.id = id;
        this.ip = ip;
        this.socket = socket;
    }

    send(type, data = null) {
        this.sendMessage({ type, data });
    }

    sendMessage(message) {
        if (this.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        this.socket.send(JSON.stringify(message));
    }

    close() {
        this.socket.close();
    }
}

class GameServer {
    constructor({ port = 3000, publicDir = null, clientRoute = "/gameClient.js", trustProxy = false } = {}) {
        this.port = port;
        this.publicDir = publicDir ? path.resolve(publicDir) : null;
        this.clientRoute = clientRoute;
        this.trustProxy = trustProxy;
        this.clientFile = path.join(import.meta.dirname, "gameClient.js");

        this.typeHandlers = new Map();
        this.responders = new Map();
        this.messageHandlers = [];
        this.connectionHandlers = [];
        this.disconnectHandlers = [];
        this.clients = new Set();

        this.createHttpServer();
        this.createWebSocketServer();
    }

    createHttpServer() {
        this.http_server = http.createServer((req, res) => {
            const urlPath = req.url.split("?")[0];

            // Server status
            if (urlPath === "/status") {
                res.end("Server is running\n");
                return;
            }

            // The browser client lives in this package, not in the consumer's public directory
            if (urlPath === this.clientRoute) {
                this.sendFile(res, this.clientFile);
                return;
            }

            if (!this.publicDir) {
                res.statusCode = 404;
                res.end("Not found");
                return;
            }

            const filePath = path.join(this.publicDir, urlPath === "/" ? "index.html" : urlPath);

            if (!filePath.startsWith(this.publicDir + path.sep)) {
                res.statusCode = 403;
                res.end("Forbidden");
                return;
            }

            this.sendFile(res, filePath);
        })
    }

    sendFile(res, filePath) {
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.statusCode = 404;
                res.end("Not found");
                return;
            }
            res.setHeader("Content-Type", CONTENT_TYPES[path.extname(filePath)] || "text/plain");
            res.end(data);
        })
    }

    createWebSocketServer() {
        this.ws_server = new WebSocketServer({ server: this.http_server });

        this.ws_server.on("connection", (ws, req) => {
            const ip = this.clientAddress(req);
            const client = new ConnectedClient(this.clientId(ip), ip, ws);
            this.clients.add(client);

            for (const handler of this.connectionHandlers) {
                handler(client);
            }

            ws.on("message", (raw) => {
                this.handleMessage(raw.toString(), client);
            })

            ws.on("close", () => {
                this.clients.delete(client);

                for (const handler of this.disconnectHandlers) {
                    handler(client);
                }
            })
        })
    }

    clientAddress(req) {
        // Only trust a forwarded header when a proxy we control sets it, since a client
        // can otherwise send one itself and choose its own id
        if (this.trustProxy) {
            const forwarded = req.headers["x-forwarded-for"];

            if (forwarded) {
                return forwarded.split(",")[0].trim();
            }
        }

        return req.socket.remoteAddress ?? "";
    }

    clientId(ip) {
        // Hashed because ids are shared with other players, and an address is not ours to hand out
        const address = ip.replace(/^::ffff:/, "");
        return crypto.createHash("sha256").update(address).digest("hex").slice(0, 12);
    }

    handleMessage(raw, client) {
        let message;

        try {
            message = JSON.parse(raw);
        } catch {
            console.warn("Ignoring message that is not valid JSON: ", raw);
            return;
        }

        if (message.requestId !== undefined) {
            this.handleRequest(message, client);
            return;
        }

        for (const handler of this.messageHandlers) {
            handler(message, client);
        }

        for (const handler of this.typeHandlers.get(message.type) ?? []) {
            handler(message.data, client);
        }
    }

    async handleRequest(message, client) {
        const { type, requestId } = message;
        const responder = this.responders.get(type);

        if (!responder) {
            client.sendMessage({ type, requestId, error: `No responder for "${type}"` });
            return;
        }

        try {
            const data = await responder(message.data, client);
            client.sendMessage({ type, requestId, data });
        } catch (error) {
            client.sendMessage({ type, requestId, error: error.message });
        }
    }

    on(type, handler) {
        const handlers = this.typeHandlers.get(type) ?? [];
        handlers.push(handler);
        this.typeHandlers.set(type, handlers);
    }

    respond(type, responder) {
        this.responders.set(type, responder);
    }

    onMessage(handler) {
        this.messageHandlers.push(handler);
    }

    onConnection(handler) {
        this.connectionHandlers.push(handler);
    }

    onDisconnect(handler) {
        this.disconnectHandlers.push(handler);
    }

    broadcast(type, data = null, { except = null } = {}) {
        for (const client of this.clients) {
            if (client === except) {
                continue;
            }
            client.send(type, data);
        }
    }

    start() {
        this.http_server.listen(this.port, () => {
            console.log(`Server listening on http://localhost:${this.port}`)
        })
    }

}

export default GameServer;
