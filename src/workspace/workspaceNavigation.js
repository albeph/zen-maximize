/**
 * @file src/workspace/workspaceNavigation.js
 * @description Helper functions for safely navigating and activating GNOME workspaces programmatically without triggering UI freezes.
 */

import GLib from 'gi://GLib';

/**
 * Safely relocates an application window across virtual workspaces and physical monitors.
 * @param {Meta.Window} win - Subject window.
 * @param {Meta.Workspace} workspace - Targeted GNOME virtual room object.
 * @param {number} monitorIndex - Fallback physical display index.
 */
export function moveWindowToWorkspace(win, workspace, monitorIndex) {
    win.change_workspace(workspace);

    if (monitorIndex >= 0 && monitorIndex < global.display.get_n_monitors()) {
        if (win.get_monitor() !== monitorIndex)
            win.move_to_monitor(monitorIndex);
    }
}

/**
 * Swaps the global system viewport to explicitly highlight the requested virtual room.
 * @param {Meta.Workspace} workspace - Virtual space to focus.
 * @param {function} log - Debug sink.
 * @param {string} reason - String traced during verbose logs denoting the trigger reason.
 */
export function activateWorkspace(workspace, log, reason) {
    try {
        workspace.activate(global.get_current_time());
        log(`[ext] activate ws:${workspace.index()} reason:${reason}`);
    } catch (e) {
        const message = e?.stack ?? e?.message ?? String(e);
        console.error(`maximize-fullscreen [activate workspace ${reason}]: ${message}`);
    }
}

/**
 * Queues a low-priority system idling loop to grab window focus once the
 * environment finishes rendering other animations or workspace swaps.
 * @param {Meta.Window} win - Objective window.
 * @param {function} log - Debug trace.
 * @param {string} reason - Justification string for verbose logs.
 */
export function focusWindowSoon(win, log, reason) {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        try {
            if (!win.minimized) {
                win.activate(global.get_current_time());
                log(`[ext] focus "${win.get_title()}" reason:${reason}`);
            }
        } catch (e) {
            const message = e?.stack ?? e?.message ?? String(e);
            console.error(`maximize-fullscreen [focus ${reason}]: ${message}`);
        }

        return GLib.SOURCE_REMOVE;
    });
}
