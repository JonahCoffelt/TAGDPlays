import GameClient from "/gameClient.js";

const gameClient = new GameClient();
gameClient.connect();

const statusElement = document.getElementById("status");
const messageElement = document.getElementById("message");
const teamPanels = document.getElementById("teamPanels");
const adminKeyPanel = document.getElementById("adminKeyPanel");
const adminKeyInput = document.getElementById("adminKey");
const sendingBtn = document.getElementById("sendingBtn");
const resetTeamsBtn = document.getElementById("resetTeamsBtn");
const presetName = document.getElementById("presetName");
const presetList = document.getElementById("presetList");
const savePresetBtn = document.getElementById("savePresetBtn");
const loadPresetBtn = document.getElementById("loadPresetBtn");
const deletePresetBtn = document.getElementById("deletePresetBtn");
const downloadPresetBtn = document.getElementById("downloadPresetBtn");
const uploadPresetBtn = document.getElementById("uploadPresetBtn");
const uploadPresetFile = document.getElementById("uploadPresetFile");

// team id -> { name, selects, activity, size, lastResult }, filled in by buildPanels
const panels = new Map();
let sending = true;
let currentMappings = null;

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

function showSending(on) {
    sending = on;
    sendingBtn.dataset.state = on ? "on" : "off";
    sendingBtn.textContent = on ? "Inputs on" : "Inputs off";
}

function adminBody(extra = {}) {
    return { ...extra, adminKey: adminKeyInput.value };
}

function element(tag, className, text) {
    const created = document.createElement(tag);

    if (className) {
        created.className = className;
    }

    if (text !== undefined) {
        created.textContent = text;
    }

    return created;
}

function buildPanel(team, { inputs, keys, mappings }) {
    const panel = element("section", "panel");

    const heading = element("div", "team-heading");
    const image = element("img", "team-image");
    image.src = team.image;
    image.alt = "";
    heading.append(image, element("h2", null, team.name));

    const table = element("table", "mappings");
    const head = table.createTHead().insertRow();
    head.append(element("th", null, "Button"), element("th", null, "Presses"));
    head.append(element("th", "numeric", "Activity"));

    const body = table.createTBody();
    const selects = new Map();
    const activity = new Map();

    for (const input of inputs) {
        const row = body.insertRow();
        row.append(element("td", "button-name", input));

        const select = document.createElement("select");
        select.append(...keys.map((key) => new Option(key, key)));
        select.value = mappings[team.id][input];
        select.addEventListener("change", () => save(team.id, input, select.value));
        row.insertCell().append(select);
        selects.set(input, select);

        const cell = element("td", "activity");
        const bar = element("span", "activity-bar");
        const count = element("span", "activity-count", "0");
        cell.append(bar, count);
        row.append(cell);
        activity.set(input, { bar, count });
    }

    const footer = element("div", "team-footer");
    const size = element("span", "team-size", "0 controllers");
    const lastResult = element("span", "team-result", "No rounds yet");
    footer.append(size, lastResult);

    panel.append(heading, table, footer);
    teamPanels.append(panel);
    panels.set(team.id, { name: team.name, selects, activity, size, lastResult });
}

function buildPanels(settings) {
    teamPanels.replaceChildren();
    panels.clear();

    for (const team of settings.teams) {
        buildPanel(team, settings);
    }
}

function showMappings(mappings) {
    currentMappings = mappings;

    for (const [id, { selects }] of panels) {
        for (const [input, select] of selects) {
            select.value = mappings[id][input];
        }
    }
}

function showSaved(saved, selected = presetList.value) {
    const names = saved ?? [];
    presetList.replaceChildren();

    if (names.length === 0) {
        presetList.append(new Option("No saved mappings", ""));
        presetList.disabled = true;
        return;
    }

    presetList.disabled = false;
    presetList.append(...names.map((name) => new Option(name, name)));

    if (names.includes(selected)) {
        presetList.value = selected;
    }
}

function showCounts(counts, sizes) {
    for (const [id, { activity, size }] of panels) {
        const tally = counts[id] ?? {};
        const highest = Math.max(1, ...Object.values(tally));

        for (const [input, { bar, count }] of activity) {
            count.textContent = tally[input] ?? 0;
            bar.style.width = `${((tally[input] ?? 0) / highest) * 100}%`;
        }

        const players = sizes[id] ?? 0;
        size.textContent = `${players} controller${players === 1 ? "" : "s"}`;
    }
}

async function save(team, input, key) {
    try {
        const { mappings } = await gameClient.request("setMapping", adminBody({ team, input, key }));
        showMappings(mappings);
        const name = panels.get(team)?.name ?? `Team ${team}`;
        say(`${name}: ${input} now presses ${key}`, "ok");
    } catch (error) {
        say(error.message);
        await load();
    }
}

async function load() {
    const settings = await gameClient.request("config");
    adminKeyPanel.hidden = !settings.locked;
    showSending(settings.sending);
    showSaved(settings.saved);

    if (panels.size === 0) {
        buildPanels(settings);
        showMappings(settings.mappings);
    } else {
        showMappings(settings.mappings);
    }
}

sendingBtn.addEventListener("click", async () => {
    try {
        const settings = await gameClient.request("setSending", adminBody({ sending: !sending }));
        showSending(settings.sending);
        say(settings.sending ? "Game is receiving inputs" : "Game is not receiving inputs", "ok");
    } catch (error) {
        say(error.message);
    }
});

resetTeamsBtn.addEventListener("click", async () => {
    try {
        await gameClient.request("resetTeams", adminBody());
        say("Everyone has been sent back to the team picker", "ok");
    } catch (error) {
        say(error.message);
    }
});

savePresetBtn.addEventListener("click", async () => {
    try {
        const settings = await gameClient.request("saveMappings", adminBody({ name: presetName.value }));
        showSaved(settings.saved, presetName.value.trim());
        say(`Saved mappings as "${presetName.value.trim()}"`, "ok");
    } catch (error) {
        say(error.message);
    }
});

loadPresetBtn.addEventListener("click", async () => {
    if (!presetList.value) {
        say("Save a mapping first");
        return;
    }

    try {
        const settings = await gameClient.request("loadMappings", adminBody({ name: presetList.value }));
        showMappings(settings.mappings);
        say(`Loaded "${presetList.value}"`, "ok");
    } catch (error) {
        say(error.message);
    }
});

deletePresetBtn.addEventListener("click", async () => {
    if (!presetList.value) {
        say("Save a mapping first");
        return;
    }

    try {
        const name = presetList.value;
        const settings = await gameClient.request("deleteMappings", adminBody({ name }));
        showSaved(settings.saved);
        say(`Deleted "${name}"`, "ok");
    } catch (error) {
        say(error.message);
    }
});

downloadPresetBtn.addEventListener("click", () => {
    if (!currentMappings) {
        say("Mappings have not loaded yet");
        return;
    }

    const blob = new Blob([`${JSON.stringify({ mappings: currentMappings }, null, 4)}\n`], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${presetName.value.trim() || "mappings"}.json`;
    link.click();
    URL.revokeObjectURL(url);
});

uploadPresetBtn.addEventListener("click", () => uploadPresetFile.click());

uploadPresetFile.addEventListener("change", async () => {
    const file = uploadPresetFile.files[0];
    uploadPresetFile.value = "";

    if (!file) {
        return;
    }

    try {
        const parsed = JSON.parse(await file.text());
        const settings = await gameClient.request("importMappings", adminBody({
            mappings: parsed.mappings ?? parsed,
        }));
        showMappings(settings.mappings);
        say(`Loaded ${file.name}`, "ok");
    } catch (error) {
        say(error.message);
    }
});

gameClient.onOpen(async () => {
    statusElement.dataset.state = "online";
    statusElement.textContent = "Connected";
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
    showSending(settings.sending);
    showSaved(settings.saved);
    showMappings(settings.mappings);
});

gameClient.on("counts", ({ counts, sizes }) => {
    showCounts(counts, sizes);
});

gameClient.on("result", (results) => {
    for (const [id, result] of Object.entries(results)) {
        const panel = panels.get(id);

        if (!panel) {
            continue;
        }

        panel.lastResult.textContent = result
            ? `Last round: ${result.input} won ${result.count} of ${result.total}, pressed ${result.key}`
            : "Last round: nobody pressed anything";
    }
});
