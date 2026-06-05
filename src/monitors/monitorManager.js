/**
 * @file src/monitors/monitorManager.js
 * @description Listens to multi-monitor geometry changes (plugging/unplugging screens) and ensures windows and states are re-evaluated to prevent glitches.
 */

import Meta from 'gi://Meta';

/**
 * Extracts the explicit hardware connector identifier (e.g. "DP-1", "HDMI-1")
 * belonging to a given logical display integer index.
 * @param {number} monitorIndex - The logical Mutter integer index of the screen.
 * @returns {string|null} The hardware connector name, or null if unresolvable.
 */
export function getConnectorForMonitor(monitorIndex) {
    try {
        const logicalMonitors = Meta.MonitorManager.get().get_logical_monitors();

        if (monitorIndex >= 0 && monitorIndex < logicalMonitors.length) {
            const physical = logicalMonitors[monitorIndex].get_monitors();
            if (physical.length > 0)
                return physical[0].get_connector();
        }
    } catch (_) { }

    return null;
}

/**
 * Recursively scans connected monitors to map a hardware string connector back to its integer index.
 * Built resiliently to default to the primary monitor if the screen was disconnected.
 * @param {string} connector - The previously saved hardware string (e.g. "HDMI-1").
 * @param {number} fallbackIndex - The old integer index used as a plan B.
 * @param {function} log - The logger function for debugging output.
 * @returns {number} The safest and most accurate logical monitor index available.
 */
export function resolveMonitorByConnector(connector, fallbackIndex, log) {
    if (!connector)
        return fallbackIndex >= 0 ? fallbackIndex : global.display.get_primary_monitor();

    try {
        const logicalMonitors = Meta.MonitorManager.get().get_logical_monitors();

        for (let i = 0; i < logicalMonitors.length; i++) {
            if (logicalMonitors[i].get_monitors().some(m => m.get_connector() === connector))
                return i;
        }
    } catch (_) { }

    log(`[mon] conector "${connector}" no encontrado → usando primario`);
    return global.display.get_primary_monitor();
}

/**
 * Listener callback executed when the global display broadcasts a monitor topology change.
 * Determines if a window in mid-flight lost its origin monitor to a cable disconnect, 
 * immediately calling for an emergency rescue to the primary display.
 * @param {Map} windowSignals - The runtime mapping of bounded windows.
 * @param {Map} states - The FullscreenState registry containing location footprints.
 * @param {function} restoreToOriginFn - The executable callback linking back to windowTracker's restore mechanism.
 * @param {function} log - The debug logger.
 */
export function onMonitorsChanged(windowSignals, states, restoreToOriginFn, log) {
    const nMonitors = global.display.get_n_monitors();
    log(`[mon] cambiaron monitores: ${nMonitors} activos`);

    for (const [win] of windowSignals.entries()) {
        const state = states.get(win);
        if (!state || !state.moved || state.inFlight)
            continue;

        const resolvedMonitor = resolveMonitorByConnector(
            state.originMonitorConnector,
            state.originMonitorIndex,
            log
        );

        const monitorDisappeared =
            state.originMonitorIndex >= nMonitors &&
            state.originMonitorConnector !== null &&
            resolvedMonitor !== state.originMonitorIndex;

        if (monitorDisappeared) {
            log(`[mon] monitor "${state.originMonitorConnector}" desconectado → rescue "${win.get_title()}"`);
            restoreToOriginFn(win, state, false);
        }
    }
}
