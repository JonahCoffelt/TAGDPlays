import path from "node:path";
import { GameServer } from "../src/index.js";

const BUTTONS = ["A", "B"];
const TALLY_INTERVAL_MS = 250;

const gameServer = new GameServer({
    // A host assigns the port at runtime; 3001 is only the local fallback
    port: process.env.PORT || 3001,
    publicDir: path.join(import.meta.dirname, "public"),
    // Behind a host's proxy every connection appears to come from the proxy, so player
    // ids only stay distinct if the forwarded address is trusted. Off locally, where
    // there is no proxy and the header would let a player choose their own id.
    trustProxy: Boolean(process.env.RENDER),
});

let votes = emptyTally();
let lastResult = null;

function emptyTally() {
    return Object.fromEntries(BUTTONS.map((button) => [button, 0]));
}

gameServer.onConnection((client) => {
    console.log(`Player ${client.id} joined, ${gameServer.clients.size} connected`);
    client.send("welcome", { buttons: BUTTONS, votes, lastResult });
});

gameServer.onDisconnect(() => {
    console.log(`A player left, ${gameServer.clients.size} connected`);
});

gameServer.on("vote", (data, client) => {
    const button = data?.button;

    if (!BUTTONS.includes(button)) {
        console.warn(`Ignoring unknown button "${button}" from ${client.id}`);
        return;
    }

    votes[button]++;
});

// Reading the winner also starts the next round, so no vote is ever pressed twice
gameServer.respond("winner", () => {
    const total = BUTTONS.reduce((sum, button) => sum + votes[button], 0);

    if (total === 0) {
        return null;
    }

    const highest = Math.max(...BUTTONS.map((button) => votes[button]));
    const tied = BUTTONS.filter((button) => votes[button] === highest);
    // Broken by chance rather than by button order, so neither button is favoured in a tie
    const button = tied[Math.floor(Math.random() * tied.length)];

    lastResult = { button, count: votes[button], total, votes };
    votes = emptyTally();

    console.log(`${button} wins with ${lastResult.count} of ${total} votes`);
    gameServer.broadcast("result", lastResult);

    return lastResult;
});

let lastBroadcast = "";

setInterval(() => {
    const encoded = JSON.stringify(votes);

    if (encoded === lastBroadcast) {
        return;
    }

    lastBroadcast = encoded;
    gameServer.broadcast("tally", votes);
}, TALLY_INTERVAL_MS);

gameServer.start();
