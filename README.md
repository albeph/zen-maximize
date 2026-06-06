# Zen Maximize (GNOME Shell Extension)

[![GNOME Version](https://img.shields.io/badge/GNOME-45%2B-blue)](https://gnome.org)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**Zen Maximize** is a GNOME Shell Extension that completely redesigns how you interact with maximized application windows and virtual workspaces. It automatically moves full-screen tasks to their own dedicated workspaces while keeping your primary desktop clean and untouched, with native support for GNOME's dynamic workspaces and fluid animations.

---

## 🧠 Philosophy: The Workspace Workflow

Inspired by how macOS elegantly manages full-screen applications, this extension brings that same clean, distraction-free workflow to Linux. Traditional desktop environments pile windows on top of each other. When you maximize an application, it covers your terminal, your unread chats, and your floating windows. This extension solves that by enforcing a more "Zen" desk space. 

* **Maximizing:** When you maximize an application to focus deeply on it, the extension intercepts this event, asks GNOME for a completely new, empty Workspace on the fly (or uses the current one if it's the only app open), and moves the maximized app there. 
* **Restoring:** When you are done focusing and decide to restore, un-maximize, or close the application, the extension magically teleports the window back to its exact original `(X, Y)` position in the Origin Workspace, destroying the empty temporary workspace. 

---

## ⚡ Quick Start & Installation

To easily install the extension from the source code, simply clone the repository and compile the schemas.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/albeph/zen-maximize ~/.local/share/gnome-shell/extensions/zen-maximize@albeph
   cd ~/.local/share/gnome-shell/extensions/zen-maximize@albeph
   ```
2. **Compile the settings schemas:**
   ```bash
   glib-compile-schemas schemas/
   ```
3. **Restart GNOME Shell:**
   * **Wayland:** Log out of your session and log back in.
   * **X11:** Press `Alt+F2`, type `r`, and hit `Enter`.
4. **Enable the Extension:**
   Use the GNOME Extensions App or the terminal:
   ```bash
   gnome-extensions enable zen-maximize@albeph
   ```
---

## ✨ Features

* **Dynamic Workspaces Native Support:** The extension embraces GNOME's default dynamic workspace behavior, seamlessly appending and managing full-screen workspaces without any glitches or interference.
* **Smart UI Animations:** When an app is maximized, the Top Bar and Ubuntu Dock slide away with smooth `Clutter.ease` transitions. Moving the mouse to the top edge intuitively reveals them.
* **Intelligent Single-App Handling:** If you maximize the only application on a desktop, the extension intelligently masks the current desktop as a temporary workspace, avoiding the creation of confusing "empty" desktops.
* **Quick Settings Toggle:** Easily turn the extension's behavior ON or OFF on the fly directly from the GNOME Quick Settings panel.
* **True Fullscreen Passthrough:** Applications in native fullscreen mode (games, videos, F11) are not intercepted by the extension — they behave exactly as GNOME intends, without interference.
* **Safe Drag-to-Unmaximize:** Dragging a window down from the title bar to restore it works flawlessly — the extension waits for the grab operation to finish before restoring the window to its original workspace, preventing the window from getting stuck to the cursor.

---

## 🖥️ Multi-Monitor Support

Zen Maximize is designed to work correctly in multi-monitor setups with intelligent safety mechanisms:

### Automatic Deactivation
By default, when GNOME's **"Workspaces on all displays"** setting is enabled, the extension detects a potential conflict and **automatically deactivates** itself. This happens because Zen Maximize uses temporary workspaces to isolate maximized windows — if workspaces span all monitors, moving a window to a temp workspace would also affect all other monitors, leading to unexpected empty screens and visual glitches.

### Manual Multi-Monitor Disable
You can also choose to **manually disable** the extension whenever more than one monitor is connected, regardless of workspace configuration. This is useful if you only want the Zen experience on a single-screen setup.

### Force Override
If you understand the implications and want to use Zen Maximize with multiple monitors anyway, you can **force the extension to stay active** by enabling the override toggle in the preferences. This ignores the automatic safety check.

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Disable when multiple monitors are connected** | Off | Completely disables the extension when 2+ monitors are detected |
| **Force execution (override)** | Off | Ignores the automatic multi-monitor deactivation and keeps the extension running |

---

## ⚙️ Configurable Settings

Zen Maximize exposes a full preferences panel accessible from the GNOME Extensions app (or Extension Manager).

### General

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable Zen Maximize** | On | Master switch to pause/resume all extension behaviors |

### Top Bar Timing

These settings control how the hidden top bar reappears and disappears in Zen workspaces:

| Setting | Default | Description |
|---------|---------|-------------|
| **Show delay (ms)** | 500 | How long the cursor must stay at the top edge before the bar slides down. Set to `0` for instant reveal |
| **Hide delay (ms)** | 500 | How long the bar stays visible after the cursor leaves the panel area. Set to `0` for instant hide |

### App Bar (Dock)

These settings control the behavior of the Ubuntu Dock / Dash to Dock when hidden. They read and write directly to the native Dock settings, so changes take effect immediately.

| Setting | Default | Description |
|---------|---------|-------------|
| **Require pressure to show** | On | When enabled, you must push the cursor firmly against the screen edge to reveal the dock (this is GNOME's default mechanism). When disabled, the dock appears by simply hovering near the edge |
| **Pressure threshold** | 100 | Amount of cursor pressure needed to trigger the dock. Higher values require more force. Only adjustable when "Require pressure" is enabled |

> **What is "pressure"?** Pressure is the default GNOME mechanism for revealing hidden UI elements at screen edges. Instead of just hovering over the edge, you must push the cursor against it — similar to how GNOME's hot corner works for the Activities overview. This prevents accidental triggers while scrolling or moving windows near edges.

---

## 🌐 Internationalization (i18n)

The extension supports translations via GNU gettext. The preferences UI is written in English by default and automatically switches to the user's system language if a translation is available.

### Currently supported languages:
- 🇬🇧 English (default)
- 🇮🇹 Italian

To add a new translation, create a `.po` file in `locale/<lang>/LC_MESSAGES/zen-maximize@albeph.po`, compile it to `.mo`, and submit a pull request.


---

## 📁 Project Structure

```
zen-maximize@albeph/
├── extension.js          # Main extension logic (UI, top bar, dock management)
├── prefs.js              # Preferences window (Adw/Gtk4)
├── metadata.json         # Extension metadata
├── schemas/              # GSettings schema (compile with glib-compile-schemas)
├── locale/               # Translations (gettext .po/.mo files)
│   └── it/LC_MESSAGES/   # Italian translation
└── src/
    ├── core/             # Constants, policies, debounce logic
    ├── monitors/         # Multi-monitor detection and management
    ├── windows/          # Window state tracking, geometry, signals
    └── workspace/        # Workspace creation, navigation, cleanup
```

---

## 🛠️ Credits & Technologies

- **Code:** albeph with Gemini 3.1 Pro and Claude Opus 4.6. 
- **Technologies:** JavaScript (GJS), Clutter/St, Mutter/Meta, GLib/Gio.
- **Original Architecture:** This project builds upon some foundational concepts and architecture originally created by [Samir Seraj](https://github.com/samirseraj03) (Workspace-Roundtrip), which have been heavily rewritten and adapted to support modern GNOME dynamic workspaces, fluid animations, and a seamless native experience.

**License:** GPL-3.0