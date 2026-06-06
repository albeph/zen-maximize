/**
 * @file src/workspace/workspaceCleanup.js
 * @description Handles garbage collection and cleanup of temporary workspaces. When an app is closed or unmaximized, this ensures the temporary workspace is properly destroyed.
 */

import { isInterestingWindow } from '../windows/windowState.js';

/**
 * Garbage collection logic examining a specific ephemeral workspace for vacancy.
 * Destroys the virtual dimension gracefully if no remaining tracked applications populate it.
 * @param {Object} policy - Workspace environment rules.
 * @param {Meta.Workspace} workspace - Targeted GNOME virtual room.
 * @param {function} log - Debugging output.
 */
export function cleanupWorkspace(policy, workspace, log) {
    if (!workspace)
        return;

    if (!policy.isTempWorkspace(workspace))
        return;

    if (!_workspaceExists(workspace)) {
        policy.unregisterTempWorkspace(workspace);
        policy.syncConfiguredWorkspaceCount();
        return;
    }

    const index = workspace.index();

    const remaining = workspace.list_windows().filter(win => {
        if (!isInterestingWindow(win))
            return false;

        if (win.is_on_all_workspaces())
            return false;

        return true;
    });

    if (remaining.length > 0) {
        log(`[ws] temp ws:${index} tiene ${remaining.length} ventana(s), no se borra`);
        policy.unregisterTempWorkspace(workspace);
        if (policy.updateUI) policy.updateUI();
        return;
    }

    if (global.workspace_manager.get_n_workspaces() <= policy.getFixedWorkspaceCount()) {
        log('[ws] no se borra temp: solo quedan workspaces fijos');
        policy.unregisterTempWorkspace(workspace);
        try { global.workspace_manager.emit('active-workspace-changed'); } catch (_) {}
        return;
    }

    try {
        policy.unregisterTempWorkspace(workspace);
        policy.syncConfiguredWorkspaceCount();
        if (policy.updateUI) policy.updateUI();
        log(`[ws] temp unregistered ws:${index}`);
    } catch (e) {
        const message = e?.stack ?? e?.message ?? String(e);
        console.error(`maximize-fullscreen [cleanup]: ${message}`);
    }
}

/**
 * Scans the native Mutter configuration to ensure the target workspace pointer is not a ghost object.
 * @param {Meta.Workspace} workspace - Virtual array object.
 * @returns {boolean} True if the workspace still mathematically exists within the compositor.
 * @private
 */
function _workspaceExists(workspace) {
    const wm = global.workspace_manager;

    for (let i = 0; i < wm.get_n_workspaces(); i++) {
        if (wm.get_workspace_by_index(i) === workspace)
            return true;
    }

    return false;
}
