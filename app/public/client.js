import GameClient from "/gameClient.js";

const gameClient = new GameClient();
gameClient.connect();

const statusElement = document.getElementById("status");

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

gameClient.onOpen(() => {
    statusElement.dataset.state = "online";
    statusElement.textContent = "Connected";
});

gameClient.onClose(() => {
    statusElement.dataset.state = "offline";
    statusElement.textContent = "Reconnecting";
});
