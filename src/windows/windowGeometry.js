/**
 * @file src/windows/windowGeometry.js
 * @description Handles the physical dimensions and coordinates of windows. Saves the original size/position of an app before it gets maximized, and restores it when unmaximized.
 */

import GLib from 'gi://GLib';

import {
    DEFAULT_WIDTH,
    DEFAULT_HEIGHT,
    GEOMETRY_RESTORE_DELAY_MS,
} from '../core/constants.js';

import { isFullscreenState } from './windowState.js';

/**
 * Evaluates the safest set of physical coordinates (x, y, width, height) a window should
 * revert to based on historical registry values or native geometric safety bounds.
 * @param {Meta.Window} win - The inspected GNOME OS window.
 * @param {Object} state - Information subset tied to the tracked registry.
 * @param {number} monitorIndex - Target hardware monitor's index constraint.
 * @returns {Object} An object housing explicit dimensional floats `{ x, y, width, height }`.
 */
export function computeSavedGeometry(win, state, monitorIndex) {
    if (state.lastNormalGeometry)
        return { ...state.lastNormalGeometry };

    try {
        if (!isFullscreenState(win)) {
            const frame = win.get_frame_rect();
            if (frame.width >= 400 && frame.height >= 300) {
                return {
                    x: frame.x,
                    y: frame.y,
                    width: frame.width,
                    height: frame.height,
                };
            }
        }
    } catch (_) { }

    return centeredGeometry(win, monitorIndex);
}

/**
 * Initiates an asynchronous countdown requesting GNOME to reposition the Meta.Window back into its
 * native space dimensions after transitioning out of Fullscreen behavior.
 * @param {Meta.Window} win - The target window.
 * @param {Object} state - Vault data mapping coordinates.
 * @param {number} monitorIndex - Restricts geometry to bounds of physical display.
 * @param {function} log - Debug console interface.
 */
export function scheduleSavedGeometryRestore(win, state, monitorIndex, log) {
    if (!state.savedGeometry)
        return;

    const geo = { ...state.savedGeometry };

    _scheduleGeometryRestore(win, state, geo, monitorIndex, log, '[ws] geometría restaurada', () => { });
}

/**
 * Re-applies geometric changes delayed artificially due to "minimize" mutations,
 * making sure windows bouncing out of minimum states revert successfully to their native areas.
 * @param {Meta.Window} win - Target window.
 * @param {Object} state - Window track reference.
 * @param {function} log - Debug interface.
 */
export function schedulePendingGeometryRestore(win, state, log) {
    if (!state.pendingRestoreGeometry)
        return;

    const geo = { ...state.pendingRestoreGeometry };
    const monitorIndex = state.pendingRestoreMonitor;

    _scheduleGeometryRestore(
        win,
        state,
        geo,
        monitorIndex,
        log,
        '[ws] geometría post-minimize restaurada',
        () => {
            state.pendingRestoreGeometry = null;
            state.pendingRestoreMonitor = -1;
            state.pendingExitFullscreen = false;
        }
    );
}

/**
 * Computes safety bounding boxes protecting actors from bleeding outside hardware boundaries.
 * Enforces strict X/Y and Width/Height normalization against logical Mutter screens.
 * @param {Meta.Window} win - Tracked application.
 * @param {Object} geo - The floating coordinates to apply.
 * @param {number} monitorIndex - Target monitor integer identifier.
 * @param {function} log - Debug stream.
 * @returns {Object} The securely clamped geometry subset.
 */
export function clampToMonitor(win, geo, monitorIndex, log) {
    try {
        const workArea = win.get_work_area_for_monitor(monitorIndex);
        const w = Math.min(geo.width, workArea.width);
        const h = Math.min(geo.height, workArea.height);

        const inBounds =
            geo.x >= workArea.x &&
            geo.y >= workArea.y &&
            geo.x + geo.width <= workArea.x + workArea.width &&
            geo.y + geo.height <= workArea.y + workArea.height;

        if (!inBounds) {
            log('[ws] geometría fuera del monitor, recentrando');
            return {
                x: workArea.x + Math.floor((workArea.width - w) / 2),
                y: workArea.y + Math.floor((workArea.height - h) / 2),
                width: w,
                height: h,
            };
        }

        return {
            x: geo.x,
            y: geo.y,
            width: w,
            height: h,
        };
    } catch (_) {
        return geo;
    }
}

/**
 * Defaults to absolute center alignments on the defined logical monitor fallback space.
 * Applies generic sizes if no historical tracking was performed for a corrupted window.
 * @param {Meta.Window} win - The native window pointer.
 * @param {number} monitorIndex - Targeted monitor index.
 * @returns {Object} Geometrically centered configuration subset.
 */
export function centeredGeometry(win, monitorIndex) {
    try {
        const workArea = win.get_work_area_for_monitor(monitorIndex);
        return {
            x: workArea.x + Math.floor((workArea.width - DEFAULT_WIDTH) / 2),
            y: workArea.y + Math.floor((workArea.height - DEFAULT_HEIGHT) / 2),
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
        };
    } catch (_) {
        return { x: 100, y: 100, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
    }
}

function _scheduleGeometryRestore(win, state, geo, monitorIndex, log, prefix, afterApply) {
    if (state.geometryTimeoutId)
        GLib.Source.remove(state.geometryTimeoutId);

    state.geometryTimeoutId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        GEOMETRY_RESTORE_DELAY_MS,
        () => {
            state.geometryTimeoutId = 0;

            try {
                if (win.minimized)
                    return GLib.SOURCE_REMOVE;

                const clamped = clampToMonitor(win, geo, monitorIndex, log);
                win.move_resize_frame(false, clamped.x, clamped.y, clamped.width, clamped.height);
                afterApply();

                log(`${prefix}: ${clamped.width}x${clamped.height} en (${clamped.x},${clamped.y})`);
            } catch (e) {
                const message = e?.stack ?? e?.message ?? String(e);
                console.error(`maximize-fullscreen [geometry restore]: ${message}`);
            }

            return GLib.SOURCE_REMOVE;
        }
    );
}
