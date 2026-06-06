/**
 * @file src/windows/windowState.js
 * @description Centralized state management for windows. Defines data structures to track if an app is currently maximized, where it came from, and handles qualification (ignoring modals/alerts).
 */

import Meta from 'gi://Meta';

export const TRACKED_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
]);

/**
 * Retrieves or lazily inflates the strict definition properties associated
 * with an active window reference within the global states map.
 * @param {Map} states - Global dictionary cache tracking actors.
 * @param {Meta.Window} win - Core GUI interface pointer assigned by GNOME.
 * @returns {Object} Extracted mapping holding boolean lifecycle gates and dimensions.
 */
export function getState(states, win) {
    if (!states.has(win)) {
        states.set(win, {
            timeoutId: 0,
            cleanupTimeoutId: 0,
            geometryTimeoutId: 0,

            lastFullscreen: false,
            moved: false,
            inFlight: false,

            originWorkspace: null,
            originIndex: -1,
            originMonitorIndex: -1,
            originMonitorConnector: null,

            savedGeometry: null,
            lastNormalGeometry: null,
            tempWorkspace: null,

            pendingRestoreGeometry: null,
            pendingRestoreMonitor: -1,
            pendingExitFullscreen: false,
        });
    }

    return states.get(win);
}

/**
 * Intelligently flushes the state properties of a specified window reference, 
 * marking its lifecycle footprint as defunct without deleting it completely.
 * @param {Object} state - A memory mapping tied to a single GUI actor.
 */
export function clearFullscreenState(state) {
    state.moved = false;
    state.inFlight = false;
    state.lastFullscreen = false;

    state.originWorkspace = null;
    state.originIndex = -1;
    state.originMonitorIndex = -1;
    state.originMonitorConnector = null;

    state.savedGeometry = null;
    state.tempWorkspace = null;
}

/**
 * Assesses structural qualifications to determine if an actor should be
 * subjected to the Fullscreen logic ecosystem. Deflects non-Standard (alerts, modals) elements.
 * @param {Meta.Window} win - Subject window for qualification.
 * @returns {boolean} True if the window behaves like a Standard application display.
 */
export function isInterestingWindow(win) {
    try {
        if (!TRACKED_TYPES.has(win.get_window_type()))
            return false;

        if (win.is_on_all_workspaces())
            return false;

        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Determines whether a window falls geometrically into the boundaries of being "Maximized" or "Fullscreen".
 * @param {Meta.Window} win - Target inspection layer.
 * @returns {boolean} True if it is currently in a maximum screen consumption state.
 */
export function isFullscreenState(win) {
    try {
        if (win.fullscreen) return false;
        return win.maximized_horizontally && win.maximized_vertically;
    } catch (_) {
        return false;
    }
}

/**
 * Mutates the central state to lock in dimensional measurements (Width, Height, X, Y)
 * prior to executing a Fullscreen mutation. Ensures return vectors exist.
 * @param {Meta.Window} win - Actor requesting layout injection.
 * @param {Object} state - Tracking interface registry reference.
 */
export function rememberNormalGeometry(win, state) {
    try {
        if (!win || win.minimized)
            return;

        if (isFullscreenState(win))
            return;

        const frame = win.get_frame_rect();
        if (frame.width < 100 || frame.height < 100)
            return;

        state.lastNormalGeometry = {
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
        };
    } catch (_) { }
}
