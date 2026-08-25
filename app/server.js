import path from "node:path";
import { GameServer } from "../src/index.js";

// Swap the images for your own by replacing the files in public/teams, or point these
// at a different path. Names show up on the picker, the controller and the admin page.
const TEAMS = [
    { id: "1", name: "Team One", image: "/teams/one.svg" },
    { id: "2", name: "Team Two", image: "/teams/two.svg" },
];

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

// Both teams get pressed in the same instant, so the defaults deliberately share no
// keys: team one is the arrow cluster, team two is WASD
const DEFAULT_MAPPINGS = {
    "1": { up: "up", down: "down", left: "left", right: "right", A: "z", B: "x", X: "c", Y: "v" },
    "2": { up: "w", down: "s", left: "a", right: "d", A: "j", B: "k", X: "l", Y: "i" },
};

// Set this to require a key before anyone can change a mapping. Worth doing whenever
// the server is reachable from the public internet, since /admin.html is not secret.
const ADMIN_KEY = process.env.ADMIN_KEY || null;

const COUNTS_INTERVAL_MS = 250;

const TEAM_IDS = TEAMS.map((team) => team.id);

const gameServer = new GameServer({
    // A host assigns the port at runtime; 3001 is only the local fallback
    port: process.env.PORT || 3001,
    publicDir: path.join(import.meta.dirname, "public"),
    // Behind a host's proxy every connection appears to come from the proxy, so player
    // ids only stay distinct if the forwarded address is trusted. Off locally, where
    // there is no proxy and the header would let a player choose their own id.
    trustProxy: Boolean(process.env.RENDER),
});

const mappings = structuredClone(DEFAULT_MAPPINGS);
// Which team each connection plays for. The browser remembers the choice and sends it
// on every connect, because a player's id is their address and everyone sharing a
// network shares one, which is far too coarse to hang team membership off.
const teamOf = new Map();
// Admin pages watch the live counts; controllers have no use for them
const admins = new Set();

let counts = emptyCounts();
let lastSent = "";
// Bumped when teams are reset, so a phone that missed the broadcast still has to pick
// again instead of rejoining from a stale localStorage value
let teamEpoch = 0;
// When false, winner polls return nothing so host.py does not press any keys
let sending = true;

function emptyTeamCounts() {
    return Object.fromEntries(INPUTS.map((input) => [input, 0]));
}

function emptyCounts() {
    return Object.fromEntries(TEAM_IDS.map((team) => [team, emptyTeamCounts()]));
}

function teamSizes() {
    const sizes = Object.fromEntries(TEAM_IDS.map((team) => [team, 0]));

    for (const team of teamOf.values()) {
        sizes[team]++;
    }

    return sizes;
}

function config() {
    return {
        teams: TEAMS,
        inputs: INPUTS,
        keys: KEYS,
        mappings,
        locked: ADMIN_KEY !== null,
        sending,
        teamEpoch,
    };
}

function requireAdmin(data) {
    if (ADMIN_KEY !== null && data?.adminKey !== ADMIN_KEY) {
        throw new Error("Wrong admin key");
    }
}

function tellAdmins(type, data) {
    for (const admin of admins) {
        admin.send(type, data);
    }
}

function publishCounts() {
    lastSent = JSON.stringify({ counts, sizes: teamSizes() });
    tellAdmins("counts", { counts, sizes: teamSizes() });
}

gameServer.onDisconnect((client) => {
    const wasPlaying = teamOf.delete(client);
    admins.delete(client);

    // Roster changes are not a press, so the counts snapshot would otherwise stay
    // the same and the admin page would keep showing a player who had already left
    if (wasPlaying) {
        publishCounts();
    }
});

gameServer.on("watch", (data, client) => {
    admins.add(client);
    client.send("counts", { counts, sizes: teamSizes() });
});

gameServer.on("join", (data, client) => {
    const team = String(data?.team);

    if (!TEAM_IDS.includes(team)) {
        console.warn(`Ignoring unknown team "${data?.team}" from ${client.id}`);
        return;
    }

    teamOf.set(client, team);
    publishCounts();
});

gameServer.on("press", (data, client) => {
    const team = teamOf.get(client);

    if (team === undefined) {
        console.warn(`Ignoring press from ${client.id}, who has not picked a team`);
        return;
    }

    const input = data?.input;

    if (!INPUTS.includes(input)) {
        console.warn(`Ignoring unknown input "${input}" from ${client.id}`);
        return;
    }

    counts[team][input]++;
});

gameServer.respond("teams", () => ({ teams: TEAMS, epoch: teamEpoch }));

gameServer.respond("config", config);

gameServer.respond("setMapping", (data) => {
    requireAdmin(data);

    const { team, input, key } = data ?? {};

    if (!TEAM_IDS.includes(team)) {
        throw new Error(`Unknown team "${team}"`);
    }

    if (!INPUTS.includes(input)) {
        throw new Error(`Unknown input "${input}"`);
    }

    if (!KEYS.includes(key)) {
        throw new Error(`Unknown key "${key}"`);
    }

    mappings[team][input] = key;
    console.log(`Team ${team}: ${input} now presses ${key}`);
    tellAdmins("config", config());

    return config();
});

gameServer.respond("setSending", (data) => {
    requireAdmin(data);

    sending = Boolean(data?.sending);
    counts = emptyCounts();
    console.log(sending ? "Input sending is on" : "Input sending is off");
    tellAdmins("config", config());
    publishCounts();

    return config();
});

gameServer.respond("resetTeams", (data) => {
    requireAdmin(data);

    teamEpoch++;
    teamOf.clear();
    counts = emptyCounts();
    console.log(`Teams reset, epoch ${teamEpoch}`);
    gameServer.broadcast("resetTeams", { epoch: teamEpoch });
    publishCounts();

    return config();
});

function takeWinner(team) {
    const tally = counts[team];
    const total = INPUTS.reduce((sum, input) => sum + tally[input], 0);

    if (total === 0) {
        return null;
    }

    const highest = Math.max(...INPUTS.map((input) => tally[input]));
    const tied = INPUTS.filter((input) => tally[input] === highest);
    // Broken by chance rather than by input order, so no input is favoured in a tie
    const input = tied[Math.floor(Math.random() * tied.length)];

    counts[team] = emptyTeamCounts();

    return { team, input, key: mappings[team][input], count: tally[input], total };
}

// Reading the winners also starts the next round for both teams, so no press is ever
// sent to the host twice
gameServer.respond("winner", () => {
    if (!sending) {
        return { sending: false, ...Object.fromEntries(TEAM_IDS.map((team) => [team, null])) };
    }

    const results = Object.fromEntries(TEAM_IDS.map((team) => [team, takeWinner(team)]));

    for (const result of Object.values(results)) {
        if (result) {
            console.log(
                `Team ${result.team}: ${result.input} wins with ${result.count} of ` +
                `${result.total}, pressing ${result.key}`,
            );
        }
    }

    tellAdmins("result", results);

    return { sending: true, ...results };
});

setInterval(() => {
    if (admins.size === 0) {
        return;
    }

    const snapshot = JSON.stringify({ counts, sizes: teamSizes() });

    if (snapshot === lastSent) {
        return;
    }

    publishCounts();
}, COUNTS_INTERVAL_MS);

gameServer.start();
