import GLib from 'gi://GLib';

/**
 * Represents the global mutable state registry held in memory for tracking windows.
 * @typedef {Object} RuntimeState
 * @property {number[]} displaySignals - Array of connection IDs for global display signals.
 * @property {Map<Meta.Window, number[]>} windowSignals - Connected signals mapped by Meta.Window instances.
 * @property {Map<number, Object>} states - Vault storing specific window geometry data labeled under unique window IDs.
 * @property {number} monitorSignal - Connection ID for monitor changes.
 * @property {number} startupTimeoutId - Timeout handle acting on extension initialization sequence.
 * @property {boolean} ready - Boolean flag asserting whether the extension is actively governing the system.
 */

/**
 * Initializes and returns a pristine runtime state object footprint.
 * @returns {RuntimeState} The initial state registry object.
 */
export function createRuntimeState() {
    return {
        displaySignals: [],
        windowSignals: new Map(),
        states: new Map(),
        monitorSignal: 0,
        startupTimeoutId: 0,
        ready: false,
    };
}

/**
 * Sweeps and garbage-collects all lingering resources tied to the runtime registry
 * before securely flushing it out of memory. Disconnects attached window signals and clears GLib loops.
 * @param {RuntimeState} runtime - The runtime registry object to dissect and clean.
 */
export function disposeRuntimeState(runtime) {
    for (const [win, ids] of runtime.windowSignals.entries()) {
        for (const id of ids) {
            try {
                win.disconnect(id);
            } catch (_) { }
        }
    }
    runtime.windowSignals.clear();

    for (const state of runtime.states.values()) {
        if (state.timeoutId)
            GLib.Source.remove(state.timeoutId);

        if (state.cleanupTimeoutId)
            GLib.Source.remove(state.cleanupTimeoutId);

        if (state.geometryTimeoutId)
            GLib.Source.remove(state.geometryTimeoutId);

    }
    runtime.states.clear();

    runtime.ready = false;
}
