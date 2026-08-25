import GameClient from "/gameClient.js";

const gameClient = new GameClient();
gameClient.connect();

const statusElement = document.getElementById("status");
const resultElement = document.getElementById("result");
const pads = document.querySelectorAll("[data-button]");

for (const pad of pads) {
    const button = pad.dataset.button;

    // pointerdown rather than click, so a vote fires the moment a thumb lands
    gameClient.addInput(pad, "pointerdown", "vote", { button });
    gameClient.addKey(`Key${button}`, "vote", { button });

    window.addEventListener("keydown", (event) => {
        if (event.code === `Key${button}` && !event.repeat) {
            flash(pad);
        }
    });
}

function flash(pad) {
    pad.classList.add("is-pressed");
    setTimeout(() => pad.classList.remove("is-pressed"), 120);
}

function setStatus(state, text) {
    statusElement.dataset.state = state;
    statusElement.textContent = text;
}

function showTally(votes) {
    for (const [button, count] of Object.entries(votes ?? {})) {
        const element = document.querySelector(`[data-count="${button}"]`);

        if (element) {
            element.textContent = count;
        }
    }
}

gameClient.onOpen(() => setStatus("online", "Connected"));
gameClient.onClose(() => setStatus("offline", "Reconnecting"));

gameClient.on("welcome", (data) => {
    showTally(data.votes);
});

gameClient.on("tally", showTally);

gameClient.on("result", (data) => {
    resultElement.textContent = `${data.button} won with ${data.count} of ${data.total} votes`;
});
