# Tidal Raycast Integration

This project enables control of the Tidal web player directly from Raycast, using a local server as a bridge.

## 📁 Structure

- `raycast-extension/` – The Raycast extension UI and commands for controlling Tidal.
- `chrome-extension/` – The Chrome extension that communicates with the Tidal web player.

## ⚙️ How It Works

1. The **Chrome extension** sends real-time track data to the local server.
2. The **Raycast extension** fetches this data and sends playback commands through the server which it hosts.

## 🚀 Getting Started

You **don’t need to clone this repo** to use the integration.

- The **Raycast extension** is available on [Raycast](https://www.raycast.com/Ek217/tidal) under `Ek217/Tidal`.
- The **Chrome extension** can be downloaded as a ZIP file from the [Releases section of this repo](https://github.com/Ek2100/tidal/releases).

If you want to explore or contribute to the code, you can explore the repo (please note any contributions to the raycast extension should also be made on the [Raycast Extensions](https://github.com/raycast/extensions) page):

```bash
git clone https://github.com/Ek2100/tidal.git
