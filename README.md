# Zen Maximize (GNOME Shell Extension)

[![GNOME Version](https://img.shields.io/badge/GNOME-45%2B-blue)](https://gnome.org)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**Zen Maximize** is a GNOME Shell Extension that completely redesigns how you interact with maximized application windows and virtual workspaces. It automatically moves full-screen tasks to their own dedicated workspaces while keeping your primary desktop clean and untouched, with native support for GNOME's dynamic workspaces and fluid animations.

---

## ✨ Features

* **Dynamic Workspaces Native Support:** The extension embraces GNOME's default dynamic workspace behavior, seamlessly appending and managing full-screen workspaces without any glitches or interference.
* **Smart UI Animations:** When an app is maximized, the Top Bar and Ubuntu Dock slide away with smooth `Clutter.ease` transitions. Moving the mouse to the top edge intuitively reveals them.
* **Intelligent Single-App Handling:** If you maximize the only application on a desktop, the extension intelligently masks the current desktop as a temporary workspace, avoiding the creation of confusing "empty" desktops.
* **Quick Settings Toggle:** Easily turn the extension's behavior ON or OFF on the fly directly from the GNOME Quick Settings panel.

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

## 🛠️ Credits & Technologies

- **Code:** albeph with the support of Gemini 3.1 Pro.
- **Technologies:** JavaScript (GJS), Clutter/St, Mutter/Meta, GLib/Gio.
- **Original Architecture:** This project builds upon foundational concepts and architecture originally created by [Samir Seraj](https://github.com/samirseraj03) (Workspace-Roundtrip), which have been heavily rewritten and adapted to support modern GNOME dynamic workspaces, fluid animations, and a seamless native experience.

**License:** GPL-3.0