import GameClient from "/gameClient.js";

// The team is remembered here rather than on the server, because a player's server-side
// id comes from their address and everyone on the venue wifi shares one
const STORAGE_KEY = "team";
const EPOCH_KEY = "teamEpoch";

const gameClient = new GameClient();
gameClient.connect();

const statusElement = document.getElementById("status");
const picker = document.getElementById("picker");
const pickerTeams = document.getElementById("pickerTeams");
const controller = document.getElementById("controller");
const badgeImage = document.getElementById("badgeImage");
const badgeName = document.getElementById("badgeName");

let teams = null;
let epoch = 0;
let team = localStorage.getItem(STORAGE_KEY);

for (const key of document.querySelectorAll("[data-input]")) {
    const input = key.dataset.input;

    // pointerdown rather than click, so a press registers the moment a thumb lands.
    // Each key listens for itself, which is what makes two-thumb presses both count.
    gameClient.addInput(key, "pointerdown", "press", { input });

    key.addEventListener("pointerdown", (event) => {
        // Keeps the press with this key even if the thumb slides off it
        key.setPointerCapture(event.pointerId);
        key.classList.add("is-pressed");
        navigator.vibrate?.(12);
    });

    for (const event of ["pointerup", "pointercancel"]) {
        key.addEventListener(event, () => key.classList.remove("is-pressed"));
    }
}

// A long press on a button otherwise raises the text selection or save-image menu
window.addEventListener("contextmenu", (event) => event.preventDefault());

function forgetTeam() {
    team = null;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(EPOCH_KEY);
}

function applyEpoch(next) {
    epoch = next;

    // A reset that happened while this phone was closed still has to stick
    if (team !== null && Number(localStorage.getItem(EPOCH_KEY)) !== next) {
        forgetTeam();
    }
}

function showPicker() {
    pickerTeams.replaceChildren(...teams.map((option) => {
        const button = document.createElement("button");
        button.className = "picker-team";
        button.type = "button";

        const image = document.createElement("img");
        image.src = option.image;
        image.alt = "";

        const name = document.createElement("span");
        name.textContent = option.name;

        button.append(image, name);
        button.addEventListener("click", () => choose(option.id));
        return button;
    }));

    picker.hidden = false;
    controller.hidden = true;
}

function showController() {
    const chosen = teams.find((option) => option.id === team);

    // The stored team is gone from the server's list, so the choice has to be made again
    if (!chosen) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(EPOCH_KEY);
        team = null;
        showPicker();
        return;
    }

    badgeImage.src = chosen.image;
    badgeImage.alt = chosen.name;
    badgeName.textContent = chosen.name;

    picker.hidden = true;
    controller.hidden = false;
}

function choose(id) {
    team = id;
    localStorage.setItem(STORAGE_KEY, id);
    localStorage.setItem(EPOCH_KEY, String(epoch));
    gameClient.send("join", { team });
    showController();
}

gameClient.onOpen(async () => {
    statusElement.dataset.state = "online";
    statusElement.textContent = "Connected";

    try {
        const payload = await gameClient.request("teams");
        teams = payload.teams;
        applyEpoch(payload.epoch);
    } catch (error) {
        statusElement.dataset.state = "offline";
        statusElement.textContent = "Could not load teams";
        return;
    }

    // The server forgets which team a connection plays for when it drops, so this has to
    // happen on every open, not just the first — and only after the epoch is known, so a
    // reset is not undone by rejoining from a stale stored team
    if (team) {
        gameClient.send("join", { team });
    }

    team ? showController() : showPicker();
});

gameClient.onClose(() => {
    statusElement.dataset.state = "offline";
    statusElement.textContent = "Reconnecting";
});

gameClient.on("resetTeams", ({ epoch: next }) => {
    applyEpoch(next);
    if (teams) {
        showPicker();
    }
});
