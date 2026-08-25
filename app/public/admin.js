import GameClient from "/gameClient.js";

const gameClient = new GameClient();
gameClient.connect();

const statusElement = document.getElementById("status");
const messageElement = document.getElementById("message");
const mappingsElement = document.getElementById("mappings");
const playersElement = document.getElementById("players");
const lastResultElement = document.getElementById("lastResult");
const adminKeyPanel = document.getElementById("adminKeyPanel");
const adminKeyInput = document.getElementById("adminKey");

const selects = new Map();
const activity = new Map();

// Remembered so a refresh mid-event does not mean typing the key again. This is
// convenience, not secrecy: anyone at this browser can read it.
adminKeyInput.value = localStorage.getItem("adminKey") ?? "";
adminKeyInput.addEventListener("input", () => {
    localStorage.setItem("adminKey", adminKeyInput.value);
});

function say(text, state = "error") {
    messageElement.textContent = text;
    messageElement.dataset.state = state;
}

function buildRows({ inputs, keys, mapping }) {
    mappingsElement.replaceChildren();
    selects.clear();
    activity.clear();

    for (const input of inputs) {
        const row = mappingsElement.insertRow();

        const name = row.insertCell();
        name.className = "button-name";
        name.textContent = input;

        const select = document.createElement("select");
        select.append(...keys.map((key) => new Option(key, key)));
        select.value = mapping[input];
        select.addEventListener("change", () => save(input, select.value));
        row.insertCell().append(select);
        selects.set(input, select);

        const cell = row.insertCell();
        cell.className = "activity";
        const bar = document.createElement("span");
        bar.className = "activity-bar";
        const count = document.createElement("span");
        count.className = "activity-count";
        count.textContent = "0";
        cell.append(bar, count);
        activity.set(input, { bar, count });
    }
}

function showMapping(mapping) {
    for (const [input, select] of selects) {
        select.value = mapping[input];
    }
}

function showCounts(counts) {
    const highest = Math.max(1, ...Object.values(counts));

    for (const [input, { bar, count }] of activity) {
        count.textContent = counts[input] ?? 0;
        bar.style.width = `${((counts[input] ?? 0) / highest) * 100}%`;
    }
}

async function save(input, key) {
    try {
        const { mapping } = await gameClient.request("setMapping", {
            input,
            key,
            adminKey: adminKeyInput.value,
        });

        showMapping(mapping);
        say(`${input} now presses ${key}`, "ok");
    } catch (error) {
        say(error.message);
        // The server refused, so put the row back to what it actually has
        await load();
    }
}

async function load() {
    const settings = await gameClient.request("config");
    adminKeyPanel.hidden = !settings.locked;

    if (selects.size === 0) {
        buildRows(settings);
    } else {
        showMapping(settings.mapping);
    }
}

gameClient.onOpen(async () => {
    statusElement.dataset.state = "online";
    statusElement.textContent = "Connected";

    // Tells the server to send this page the live press counts
    gameClient.send("watch");

    try {
        await load();
    } catch (error) {
        say(`Could not load the mappings: ${error.message}`);
    }
});

gameClient.onClose(() => {
    statusElement.dataset.state = "offline";
    statusElement.textContent = "Reconnecting";
});

gameClient.on("config", (settings) => {
    adminKeyPanel.hidden = !settings.locked;
    showMapping(settings.mapping);
});

gameClient.on("counts", ({ counts, players }) => {
    showCounts(counts);
    playersElement.textContent = players;
});

gameClient.on("result", (result) => {
    lastResultElement.textContent =
        `Last round: ${result.input} won ${result.count} of ${result.total}, pressed ${result.key}`;
});
