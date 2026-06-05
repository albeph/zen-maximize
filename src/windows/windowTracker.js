/**
 * @file src/windows/windowTracker.js
 * @description Listens to Mutter/GNOME signals (like window creation, maximization, minimization) and evaluates when a window should be moved to a fullscreen workspace.
 */

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import { DEBOUNCE_MS } from '../core/constants.js';

import {
    getState,
    isInterestingWindow,
    isFullscreenState,
    rememberNormalGeometry,
} from './windowState.js';

import {
    sendToTempWorkspace,
    restoreToOrigin,
    restoreToOriginMinimized,
    schedulePendingGeometryRestore,
    cleanupAfterRestore,
} from '../workspace/workspaceManager.js';

/**
 * Establishes intensive GNOME Mutter signal listeners strictly tied to a single Meta.Window.
 * Evaluates in real-time whether the incoming window requires entry into the Fullscreen lifecycle.
 * @param {Meta.Window} win - The native GUI window instance.
 * @param {Map} windowSignals - The runtime mapping storing signal connection IDs.
 * @param {Map} states - State registry vault.
 * @param {Object} policy - Injection-ready context policies (usually referring to Workspace limits).
 * @param {function} log - Debugging tool.
 */
export function trackWindow(win, windowSignals, states, policy, log) {
    if (!win) return;
    if (windowSignals.has(win)) return;
    if (!isInterestingWindow(win)) return;

    const ids = [];
    ids.push(win.connect('notify::maximized-horizontally', () => queueEvaluate(win, states, windowSignals, policy, log)));
    ids.push(win.connect('notify::maximized-vertically', () => queueEvaluate(win, states, windowSignals, policy, log)));
    ids.push(win.connect('notify::fullscreen', () => queueEvaluate(win, states, windowSignals, policy, log)));
    ids.push(win.connect('notify::minimized', () => onMinimizedChanged(win, states, windowSignals, policy, log)));
    ids.push(win.connect('workspace-changed', () => onWorkspaceChanged(win, states, log)));
    ids.push(win.connect('size-changed', () => onGeometryChanged(win, states)));
    ids.push(win.connect('position-changed', () => onGeometryChanged(win, states)));
    ids.push(win.connect('unmanaged', () => onUnmanaged(win, windowSignals, states, policy, log)));

    windowSignals.set(win, ids);

    const state = getState(states, win);
    rememberNormalGeometry(win, state);
    state.lastFullscreen = isFullscreenState(win);
}

/**
 * Sever all signal connections to GNOME native events, clears polling timeouts,
 * and purges the window's presence from the tracking arrays.
 * @param {Meta.Window} win - Subject window.
 * @param {Map} windowSignals - Signals registry.
 * @param {Map} states - States registry.
 */
export function disconnectWindow(win, windowSignals, states) {
    const ids = windowSignals.get(win) ?? [];
    for (const id of ids) {
        try {
            win.disconnect(id);
        } catch (_) { }
    }

    windowSignals.delete(win);

    const state = states.get(win);
    if (state) {
        if (state.timeoutId)
            GLib.Source.remove(state.timeoutId);

        if (state.geometryTimeoutId)
            GLib.Source.remove(state.geometryTimeoutId);
    }

    states.delete(win);
}

/**
 * Callback firing whenever window rect geometry mutations occur. Caches the coordinates 
 * for safe return trips if the window isn't currently mid-flight.
 * @private
 */
function onGeometryChanged(win, states) {
    const state = getState(states, win);
    rememberNormalGeometry(win, state);
}

/**
 * Anti-flicker debouncer routing rapid OS-level `size-changed` assertions
 * into a solid evaluation of whether a Fullscreen is necessary.
 * @private
 */
function queueEvaluate(win, states, windowSignals, policy, log) {
    const state = getState(states, win);

    if (state.timeoutId)
        GLib.Source.remove(state.timeoutId);

    state.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
        state.timeoutId = 0;
        evaluateWindow(win, states, windowSignals, policy, log);
        return GLib.SOURCE_REMOVE;
    });
}

/**
 * Logic core dictating the actions generated due to a window reaching or leaving the bounds
 * of a Maximized/Fullscreen aspect ratio. Orchestrates `sendToTempWorkspace` or `restoreToOrigin`.
 * @private
 */
function evaluateWindow(win, states, windowSignals, policy, log) {
    if (!windowSignals.has(win))
        return;

    const state = getState(states, win);
    const nowFullscreen = isFullscreenState(win);
    const wasFullscreen = state.lastFullscreen;

    if (!nowFullscreen)
        rememberNormalGeometry(win, state);

    state.lastFullscreen = nowFullscreen;

    try {
        if (win.minimized) {
            log(`[sig] "${win.get_title()}" minimizada: ignorando cambio maximized/fullscreen`);
            return;
        }
    } catch (_) { }

    if (nowFullscreen && !wasFullscreen) {
        sendToTempWorkspace(win, state, policy, log);
        return;
    }

    if (!nowFullscreen && wasFullscreen) {
        restoreToOrigin(win, state, policy, false, log);
    }
}

/**
 * Complex controller regulating how the window should behave if the user hits the "Minimize" command.
 * Pauses standard geometry evaluations and triggers specific `restoreToOriginMinimized` behaviors.
 * @private
 */
function onMinimizedChanged(win, states, windowSignals, policy, log) {
    const state = getState(states, win);

    let minimized = false;
    try {
        minimized = win.minimized;
    } catch (_) {
        return;
    }

    if (minimized) {
        if (!state.moved) {
            log(`[sig] "${win.get_title()}" minimizada sin fullscreen`);
            return;
        }

        log(`[sig] "${win.get_title()}" minimizada con fullscreen → fijo/origen sin desminimizar`);
        restoreToOriginMinimized(win, state, policy, log);
        state.lastFullscreen = false;
        return;
    }

    if (!state.pendingExitFullscreen && !state.pendingRestoreGeometry) {
        rememberNormalGeometry(win, state);
        return;
    }

    log(`[sig] "${win.get_title()}" desminimizada → aplicar salida de fullscreen`);

    try {
        if (state.pendingExitFullscreen) {
            if (win.fullscreen)
                win.unmake_fullscreen();

            if (win.maximized_horizontally || win.maximized_vertically)
                win.unmaximize(Meta.MaximizeFlags.BOTH);

            state.pendingExitFullscreen = false;
        }
    } catch (_) { }

    schedulePendingGeometryRestore(win, state, log);
}

/**
 * Resolves logic when the user forcefully overrides the default virtual room by dragging
 * a window onto another Workspace manually, canceling the automatized Fullscreen ecosystem.
 * @private
 */
function onWorkspaceChanged(win, states, log) {
    const state = states.get(win);
    if (!state)
        return;

    rememberNormalGeometry(win, state);

    if (!state.moved || state.inFlight)
        return;

    const currentWorkspace = win.get_workspace();
    if (!currentWorkspace)
        return;

    if (state.tempWorkspace &&
        currentWorkspace !== state.tempWorkspace &&
        !isFullscreenState(win)) {
        log(`[sig] "${win.get_title()}" movida manualmente → cancelando fullscreen`);
        cleanupAfterRestore(state, {
            isTempWorkspace: ws => ws === state.tempWorkspace,
            unregisterTempWorkspace: () => { },
            getFixedWorkspaceCount: () => 1,
            isFixedWorkspace: () => false,
            syncConfiguredWorkspaceCount: () => { },
        }, log);
    }
}

/**
 * Final execution path ran when a tracked window decides to close (unmanage).
 * If the application closes while sitting alone in an ephemeral workspace, it commands
 * an immediate return to the origin index to prevent the user from being stranded.
 * @private
 */
function onUnmanaged(win, windowSignals, states, policy, log) {
    const state = states.get(win);

    if (state?.moved) {
        log(`[sig] "${win.get_title()}" cerrada con fullscreen activo → volver al origen`);
        restoreToOrigin(win, state, policy, true, log);
    }

    disconnectWindow(win, windowSignals, states);
}
