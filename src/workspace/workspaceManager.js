/**
 * @file src/workspace/workspaceManager.js
 * @description The core engine that orchestrates window movements. Moves maximized windows to new temporary workspaces and pulls them back to their origin when unmaximized.
 */

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {
    CLEANUP_DELAY_MS,
    REDIRECT_DELAY_MS,
} from '../core/constants.js';

import {
    getState,
    clearFullscreenState,
    isInterestingWindow,
    isFullscreenState,
} from '../windows/windowState.js';

import {
    computeSavedGeometry,
    scheduleSavedGeometryRestore,
    schedulePendingGeometryRestore,
} from '../windows/windowGeometry.js';

import {
    getConnectorForMonitor,
    resolveMonitorByConnector,
} from '../monitors/monitorManager.js';

import {
    moveWindowToWorkspace,
    activateWorkspace,
    focusWindowSoon,
} from './workspaceNavigation.js';

import { cleanupWorkspace } from './workspaceCleanup.js';

/**
 * Primary action to execute Phase B (Dispersion) of the Fullscreen ecosystem.
 * Appends a new workspace to Mutter and commands the window to translocate into it.
 * @param {Meta.Window} win - The subject application.
 * @param {Object} state - Information repository tied to the window.
 * @param {Object} policy - Current environment restrictions instance.
 * @param {function} log - Console debugger.
 * @param {Object} options - Instruction modifiers (`follow` boolean overrides focus and animation tracking).
 */
export function sendToTempWorkspace(win, state, policy, log, options = {}) {
    const { follow = true, focus = true } = options;

    if (policy.isActive && !policy.isActive()) {
        return;
    }

    if (state.moved || state.inFlight) {
        log(`[ws] ida ignorada "${win.get_title()}" (moved=${state.moved}, inFlight=${state.inFlight})`);
        return;
    }

    policy.ensureFixedWorkspaces();

    const currentWorkspace = win.get_workspace();
    if (!currentWorkspace)
        return;

    const originWorkspace = currentWorkspace;

    const originIndex = originWorkspace.index();
    const monitorIndex = win.get_monitor();
    const monitorConnector = getConnectorForMonitor(monitorIndex);

    if (Meta.prefs_get_workspaces_only_on_primary() || (policy.isMultiMonitorDisabled && policy.isMultiMonitorDisabled())) {
        const primaryMonitor = global.display.get_primary_monitor();
        if (monitorIndex !== primaryMonitor) {
            log(`[ws] ida ignorada "${win.get_title()}" (secondary monitor disabled by settings or workspaces-only-on-primary)`);
            return;
        }
    }

    state.inFlight = true;
    state.originWorkspace = originWorkspace;
    state.originIndex = originIndex;
    state.originMonitorIndex = monitorIndex;
    state.originMonitorConnector = monitorConnector;
    state.savedGeometry = computeSavedGeometry(win, state, monitorIndex);

    try {
        let isAlone = true;
        for (const w of originWorkspace.list_windows()) {
            if (w !== win && isInterestingWindow(w) && !w.is_on_all_workspaces()) {
                isAlone = false;
                break;
            }
        }

        let tempWorkspace;
        let tempIndex;

        if (isAlone) {
            tempWorkspace = originWorkspace;
            tempIndex = originWorkspace.index();
            policy.registerTempWorkspace(tempWorkspace);
            
            if (policy.updateUI) policy.updateUI();
            
            log(`[ws] ida "${win.get_title()}" ws:${originIndex} (already alone, marked as temp)`);
        } else {
            tempWorkspace = policy.allocateTempWorkspace(originWorkspace);
            tempIndex = tempWorkspace.index();

            log(`[ws] ida "${win.get_title()}" ws:${originIndex} → temp ws:${tempIndex}`);

            moveWindowToWorkspace(win, tempWorkspace, monitorIndex);
            log(`[ws] move confirm "${win.get_title()}" → ws:${tempIndex}`);

            if (follow)
                activateWorkspace(tempWorkspace, log, 'ida');
        }

        state.tempWorkspace = tempWorkspace;
        state.moved = true;

        if (focus && !win.minimized)
            focusWindowSoon(win, log, 'ida');
    } catch (e) {
        const message = e?.stack ?? e?.message ?? String(e);
        console.error(`maximize-fullscreen [ida]: ${message}`);
        clearFullscreenState(state);
    } finally {
        state.inFlight = false;
    }
}

/**
 * Inverse primary action to execute Phase C (Collection) of the Fullscreen ecosystem.
 * Retracts the window natively from its ephemeral workspace back into the origin fixed dimension.
 * @param {Meta.Window} win - Bounded application.
 * @param {Object} state - Window constraints vault.
 * @param {Object} policy - Dimension limits API.
 * @param {boolean} fromClose - Determines if the return trip was spawned due to an application dying.
 * @param {function} log - Debugger.
 */
export function restoreToOrigin(win, state, policy, fromClose, log) {
    if (!state.moved || state.inFlight)
        return;

    policy.ensureFixedWorkspaces();

    const originWorkspace = _resolveOriginWorkspace(state, policy);
    if (!originWorkspace) {
        log('[ws] vuelta: no existe origen fijo, limpiando');
        cleanupAfterRestore(state, policy, log);
        return;
    }

    const resolvedMonitor = resolveMonitorByConnector(
        state.originMonitorConnector,
        state.originMonitorIndex,
        log
    );

    log(`[ws] vuelta "${fromClose ? '[cerrada]' : win.get_title()}" → ws:${originWorkspace.index()}`);

    state.inFlight = true;

    try {
        if (!fromClose) {
            _attemptExitFullscreenState(win);
            moveWindowToWorkspace(win, originWorkspace, resolvedMonitor);
            activateWorkspace(originWorkspace, log, 'vuelta');

            if (!win.minimized)
                focusWindowSoon(win, log, 'vuelta');

            scheduleSavedGeometryRestore(win, state, resolvedMonitor, log);
        } else {
            activateWorkspace(originWorkspace, log, 'close');
        }
    } catch (e) {
        const message = e?.stack ?? e?.message ?? String(e);
        console.error(`maximize-fullscreen [vuelta]: ${message}`);
    } finally {
        state.inFlight = false;
        cleanupAfterRestore(state, policy, log);
    }
}

/**
 * Executes a specific variant of Phase C exclusively built for restoring windows
 * attempting to minimize while stuck in an active Fullscreen state.
 * @param {Meta.Window} win - Bounded application.
 * @param {Object} state - Constraints repository.
 * @param {Object} policy - Dimension bounds mapping.
 * @param {function} log - Console debugger.
 */
export function restoreToOriginMinimized(win, state, policy, log) {
    if (!state.moved || state.inFlight)
        return;

    policy.ensureFixedWorkspaces();

    const originWorkspace = _resolveOriginWorkspace(state, policy);
    if (!originWorkspace) {
        log('[ws] vuelta minimizada: no existe origen fijo, limpiando');
        cleanupAfterRestore(state, policy, log);
        return;
    }

    const resolvedMonitor = resolveMonitorByConnector(
        state.originMonitorConnector,
        state.originMonitorIndex,
        log
    );

    log(`[ws] vuelta minimizada "${win.get_title()}" → ws:${originWorkspace.index()}`);

    state.inFlight = true;
    state.pendingRestoreGeometry = state.savedGeometry ? { ...state.savedGeometry } : null;
    state.pendingRestoreMonitor = resolvedMonitor;

    try {
        state.pendingExitFullscreen = _attemptExitFullscreenState(win);
        moveWindowToWorkspace(win, originWorkspace, resolvedMonitor);
        activateWorkspace(originWorkspace, log, 'minimize');
    } catch (e) {
        const message = e?.stack ?? e?.message ?? String(e);
        console.error(`maximize-fullscreen [vuelta minimizada]: ${message}`);
    } finally {
        state.inFlight = false;
        cleanupAfterRestore(state, policy, log);
    }
}

/**
 * Mounts standard timeouts clearing runtime memories and evaluating the ephemeral
 * workspace for deletion (Garbage Collection) after normal fullscreen maneuvers.
 * @param {Object} state - Central properties mapping.
 * @param {Object} policy - Core workspace rules.
 * @param {function} log - Standard log sink.
 */
export function cleanupAfterRestore(state, policy, log) {
    const tempWorkspace = state.tempWorkspace;

    clearFullscreenState(state);

    if (state.cleanupTimeoutId)
        GLib.Source.remove(state.cleanupTimeoutId);

    state.cleanupTimeoutId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        CLEANUP_DELAY_MS,
        () => {
            state.cleanupTimeoutId = 0;
            cleanupWorkspace(policy, tempWorkspace, log);
            return GLib.SOURCE_REMOVE;
        }
    );
}

/**
 * Enforces hygiene boundaries when the extension is toggled on inside a lively system.
 * Scans for already-maximized applications bleeding into fixed workspaces and evicts them immediately.
 * @param {Map} windowSignals - Dictionary dictating tracked sessions.
 * @param {Map} states - Core location tracking maps.
 * @param {Object} policy - Bounds configuration mapping.
 * @param {function} log - Console log stream.
 */
export function normalizeFixedWorkspaceFullscreenWindows(windowSignals, states, policy, log) {
    policy.ensureFixedWorkspaces();

    for (const [win] of windowSignals.entries()) {
        try {
            if (!win || win.minimized)
                continue;

            if (!isInterestingWindow(win))
                continue;

            const ws = win.get_workspace();
            if (!policy.isFixedWorkspace(ws))
                continue;

            if (!isFullscreenState(win))
                continue;

            if (Meta.prefs_get_workspaces_only_on_primary() || (policy.isMultiMonitorDisabled && policy.isMultiMonitorDisabled())) {
                const primaryMonitor = global.display.get_primary_monitor();
                if (win.get_monitor() !== primaryMonitor)
                    continue;
            }

            const state = getState(states, win);
            if (state.moved || state.inFlight)
                continue;

            log(`[ws] startup normaliza "${win.get_title()}" grande en fijo ws:${ws.index()} → temp`);
            sendToTempWorkspace(win, state, policy, log, { follow: false, focus: false });
        } catch (e) {
            const message = e?.stack ?? e?.message ?? String(e);
            console.error(`maximize-fullscreen [normalize fixed ws]: ${message}`);
        }
    }
}

/**
 * Guards ephemeral workspaces from rogue popup windows opening inside them by redirecting
 * unrecognized Meta constructs back onto the Origin fixed root index automatically.
 * @param {Meta.Window} win - Intruding native actor.
 * @param {Map} states - Environment tracking logs.
 * @param {Object} policy - Root bound limitations.
 * @param {function} log - Debugging.
 */
export function redirectNewWindowToFixedWorkspace(win, states, policy, log) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, REDIRECT_DELAY_MS, () => {
        try {
            if (!win || win.is_on_all_workspaces())
                return GLib.SOURCE_REMOVE;

            if (!isInterestingWindow(win))
                return GLib.SOURCE_REMOVE;

            if (win.get_transient_for() != null)
                return GLib.SOURCE_REMOVE;

            const winWs = win.get_workspace();
            if (!winWs || !policy.isTempWorkspace(winWs))
                return GLib.SOURCE_REMOVE;

            const fixedWs = policy.getFixedWorkspaceForNewWindows();
            if (fixedWs && fixedWs !== winWs) {
                log(`[ext] redirigiendo nueva ventana "${win.get_title()}" temp ws:${winWs.index()} → fijo ws:${fixedWs.index()}`);
                win.change_workspace(fixedWs);
                activateWorkspace(fixedWs, log, 'redirect_new_window');
                focusWindowSoon(win, log, 'redirect_new_window');
            }
        } catch (e) {
            const message = e?.stack ?? e?.message ?? String(e);
            console.error(`maximize-fullscreen [redirect new window]: ${message}`);
        }

        return GLib.SOURCE_REMOVE;
    });
}

export { schedulePendingGeometryRestore };


/**
 * Private abstraction interrogating policy bounds to derive a hard fallback string map.
 * @private
 */
function _resolveOriginWorkspace(state, policy) {
    const wm = global.workspace_manager;
    let originExists = false;

    if (state.originWorkspace) {
        try {
            for (let i = 0; i < wm.get_n_workspaces(); i++) {
                if (wm.get_workspace_by_index(i) === state.originWorkspace) {
                    originExists = true;
                    break;
                }
            }
        } catch (_) {}
    }

    if (originExists)
        return state.originWorkspace;

    try {
        let fallbackIndex = state.originIndex >= 0 ? state.originIndex : 0;
        let newWs = wm.append_new_workspace(false, global.get_current_time());
        
        if (typeof wm.reorder_workspace === 'function') {
            wm.reorder_workspace(newWs, fallbackIndex);
        }
        
        return newWs;
    } catch (_) {
        return policy.getDefaultOriginWorkspace();
    }
}

/**
 * Purges maximization and fullscreen logical constraints from native Mutter actors smoothly.
 * @private
 */
function _attemptExitFullscreenState(win) {
    try {
        if (win.fullscreen)
            win.unmake_fullscreen();

        if (win.maximized_horizontally || win.maximized_vertically)
            win.unmaximize(Meta.MaximizeFlags.BOTH);
    } catch (_) { }

    return isFullscreenState(win);
}
