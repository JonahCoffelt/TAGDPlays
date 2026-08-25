import path from "node:path";
import { GameServer } from "../src/index.js";

const INPUTS = ["up", "down", "left", "right", "A", "B", "X", "Y"];

// Every key host.py knows how to press, so a mapping can never ask for something
// the host would choke on. Kept in step with SUPPORTED_KEYS in keypress.py.
const KEYS = [
    ..."abcdefghijklmnopqrstuvwxyz",
    ..."0123456789",
    "up", "down", "left", "right",
    "space", "enter", "esc", "tab", "backspace",
    "shift", "ctrl", "alt",
];

const DEFAULT_MAPPING = {
    up: "up",
    down: "down",
    left: "left",
    right: "right",
    A: "z",
    B: "x",
    X: "a",
    Y: "s",
};

// Set this to require a key before anyone can change the mapping. Worth doing whenever
// the server is reachable from the public internet, since /admin.html is not secret.
const ADMIN_KEY = process.env.ADMIN_KEY || null;

const COUNTS_INTERVAL_MS = 250;

const gameServer = new GameServer({
    // A host assigns the port at runtime; 3001 is only the local fallback
    port: process.env.PORT || 3001,
    publicDir: path.join(import.meta.dirname, "public"),
    // Behind a host's proxy every connection appears to come from the proxy, so player
    // ids only stay distinct if the forwarded address is trusted. Off locally, where
    // there is no proxy and the header would let a player choose their own id.
    trustProxy: Boolean(process.env.RENDER),
});

const mapping = { ...DEFAULT_MAPPING };
// Admin pages watch the live counts; controllers have no use for them
const admins = new Set();

let counts = emptyCounts();
let lastResult = null;

function emptyCounts() {
    return Object.fromEntries(INPUTS.map((input) => [input, 0]));
}

function config() {
    return { inputs: INPUTS, keys: KEYS, mapping, locked: ADMIN_KEY !== null };
}

function tellAdmins(type, data) {
    for (const admin of admins) {
        admin.send(type, data);
    }
}

gameServer.onDisconnect((client) => {
    admins.delete(client);
});

gameServer.on("watch", (data, client) => {
    admins.add(client);
});

gameServer.on("press", (data, client) => {
    const input = data?.input;

    if (!INPUTS.includes(input)) {
        console.warn(`Ignoring unknown input "${input}" from ${client.id}`);
        return;
    }

    counts[input]++;
});

gameServer.respond("config", config);

gameServer.respond("setMapping", (data) => {
    if (ADMIN_KEY !== null && data?.adminKey !== ADMIN_KEY) {
        throw new Error("Wrong admin key");
    }

    const { input, key } = data ?? {};

    if (!INPUTS.includes(input)) {
        throw new Error(`Unknown input "${input}"`);
    }

    if (!KEYS.includes(key)) {
        throw new Error(`Unknown key "${key}"`);
    }

    mapping[input] = key;
    console.log(`${input} now presses ${key}`);
    tellAdmins("config", config());

    return config();
});

// Reading the winner also starts the next round, so no press is ever sent to the host twice
gameServer.respond("winner", () => {
    const total = INPUTS.reduce((sum, input) => sum + counts[input], 0);

    if (total === 0) {
        return null;
    }

    const highest = Math.max(...INPUTS.map((input) => counts[input]));
    const tied = INPUTS.filter((input) => counts[input] === highest);
    // Broken by chance rather than by input order, so no input is favoured in a tie
    const input = tied[Math.floor(Math.random() * tied.length)];

    lastResult = { input, key: mapping[input], count: counts[input], total, counts };
    counts = emptyCounts();

    console.log(`${input} wins with ${lastResult.count} of ${total}, pressing ${lastResult.key}`);
    tellAdmins("result", lastResult);

    return lastResult;
});

let lastSent = "";

setInterval(() => {
    if (admins.size === 0) {
        return;
    }

    const snapshot = JSON.stringify(counts);

    if (snapshot === lastSent) {
        return;
    }

    lastSent = snapshot;
    tellAdmins("counts", { counts, players: gameServer.clients.size - admins.size });
}, COUNTS_INTERVAL_MS);

gameServer.start();
