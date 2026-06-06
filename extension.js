/**
 * @file extension.js
 * @description Entry point of the Zen Maximize extension. Handles the GNOME Shell extension lifecycle (enable/disable), UI hooks (Top Bar hiding), and quick settings integration.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { STARTUP_GRACE_MS, TOP_BAR_HIDE_DELAY_MS } from './src/core/constants.js';
import { createLogger } from './src/core/logger.js';
import { createRuntimeState, disposeRuntimeState } from './src/core/stateRegistry.js';

import { WorkspacePolicy } from './src/policy/workspacePolicy.js';
import { trackWindow } from './src/windows/windowTracker.js';
import {
    normalizeFixedWorkspaceFullscreenWindows,
    redirectNewWindowToFixedWorkspace,
    restoreToOrigin,
} from './src/workspace/workspaceManager.js';
import { onMonitorsChanged } from './src/monitors/monitorManager.js';
import { FullscreenIndicator } from './src/ui/quickToggle.js';

/**
 * The root entrypoint for the Maximize Fullscreen extension spanning the GNOME lifecycle.
 * Instantiated natively by GNOME Shell when parsing metadata.json configurations.
 */
export default class ZenMaximizeExtension extends Extension {
    /**
     * Fired by Mutter when the user flips the toggle to activate the extension.
     * Hooks immediately into runtime and defers UI generation to circumvent Wayland graphical initialization races.
     */
    enable() {
        this._log = createLogger(this.metadata.uuid);
        this._runtime = createRuntimeState();
        this._policy = new WorkspacePolicy(this._log);

        this._runtime.startupTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            STARTUP_GRACE_MS,
            () => {
                this._runtime.startupTimeoutId = 0;
                this._finishEnable();
                return GLib.SOURCE_REMOVE;
            }
        );

        this._log(`[ext] arranque diferido ${STARTUP_GRACE_MS}ms`);
    }

    /**
     * Delayed secondary startup phase triggered roughly ~1.5 seconds post-enable. 
     * Registers Alt+Tab injectors and mounts visual observers without breaking initial OS load times.
     * @private
     */
    _finishEnable() {
        if (!this._runtime || this._runtime.ready)
            return;

        this._policy.ensureFixedWorkspaces();
        this._runtime.ready = true;

        const settings = this.getSettings('org.gnome.shell.extensions.zen-maximize');

        this._policy.isActive = () => {
            if (!settings.get_boolean('is-active')) return false;
            
            const nMonitors = global.display.get_n_monitors();

            if (settings.get_boolean('disable-on-secondary-monitors') && nMonitors > 1) {
                return false;
            }

            if (settings.get_boolean('disable-auto-multi-monitor')) return true;

            // Automatically disable the extension if multiple monitors are connected
            // AND the user has GNOME configured to put workspaces on all displays.
            if (nMonitors > 1 && !Meta.prefs_get_workspaces_only_on_primary()) {
                return false;
            }
            return true;
        };
        this._policy.isMultiMonitorDisabled = () => false; // We no longer use the old per-window logic

        this._quickIndicator = new FullscreenIndicator(settings);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._quickIndicator);

        this._runtime.displaySignals.push(
            global.display.connect('window-created', (_display, win) => {
                trackWindow(
                    win,
                    this._runtime.windowSignals,
                    this._runtime.states,
                    this._policy,
                    m => this._log(m)
                );

                redirectNewWindowToFixedWorkspace(
                    win,
                    this._runtime.states,
                    this._policy,
                    m => this._log(m)
                );
            })
        );

        this._runtime.monitorSignal = Main.layoutManager.connect(
            'monitors-changed',
            () => {
                this._syncActiveState();
                onMonitorsChanged(
                    this._runtime.windowSignals,
                    this._runtime.states,
                    (win, state, fromClose) =>
                        restoreToOrigin(win, state, this._policy, fromClose, m => this._log(m)),
                    m => this._log(m)
                );
            }
        );

        try {
            this._dockSettings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.dash-to-dock' });
        } catch (e) {
            this._dockSettings = null;
        }
        this._dockWasFixed = false;
        this._dockWasNoAutohideFS = false;
        this._dockOriginalPressure = null;
        if (this._dockSettings) {
            try {
                if (!this._dockSettings.get_boolean('require-pressure-to-show')) {
                    this._dockOriginalPressure = false;
                    this._dockSettings.set_boolean('require-pressure-to-show', true);
                }
            } catch (_) {}
        }
        this._panelTimeoutId = 0;

        const setPanelStruts = (enabled) => {
            const trackData = Main.layoutManager._trackedActors.find(a => a.actor === Main.layoutManager.panelBox);
            if (trackData && trackData.affectsStruts !== enabled) {
                trackData.affectsStruts = enabled;
                Main.layoutManager._queueUpdateRegions();
            }
        };

        const easeAllWindowActors = (translationY, duration) => {
            const activeWs = global.workspace_manager.get_active_workspace();
            const wins = activeWs.list_windows();
            for (const w of wins) {
                const actor = w.get_compositor_private();
                if (actor && !w.is_skip_taskbar()) {
                    if (duration > 0) {
                        actor.ease({
                            translation_y: translationY,
                            duration,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD
                        });
                    } else {
                        actor.remove_transition('translation_y');
                        actor.translation_y = translationY;
                    }
                }
            }
        };

        const hideTopBar = () => {
            if (this._panelTimeoutId) {
                GLib.Source.remove(this._panelTimeoutId);
                this._panelTimeoutId = 0;
            }
            if (this._pointerTrackerId) {
                GLib.Source.remove(this._pointerTrackerId);
                this._pointerTrackerId = 0;
            }
            if (this._topEdgeTrigger) this._topEdgeTrigger.reactive = true;

            const panelH = Main.layoutManager.panelBox.height;

            // Slide panel up
            Main.layoutManager.panelBox.ease({
                translation_y: -panelH,
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });

            // Pull all windows back up to fill entire screen
            easeAllWindowActors(0, 250);
        };

        const showTopBar = () => {
            if (this._panelTimeoutId) {
                GLib.Source.remove(this._panelTimeoutId);
                this._panelTimeoutId = 0;
            }
            if (this._pointerTrackerId) {
                GLib.Source.remove(this._pointerTrackerId);
                this._pointerTrackerId = 0;
            }

            const panelH = Main.layoutManager.panelBox.height;

            // Slide panel down into view
            Main.layoutManager.panelBox.ease({
                translation_y: 0,
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });

            // Push all windows down to make room for the panel
            easeAllWindowActors(panelH, 250);

            if (this._topEdgeTrigger) this._topEdgeTrigger.reactive = false;

            // Start pointer tracker to auto-hide when mouse leaves panel area
            this._pointerTrackerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                let ptrY = -1;
                try {
                    const [, y] = global.get_pointer();
                    ptrY = y;
                } catch (_) {
                    return GLib.SOURCE_CONTINUE;
                }

                if (ptrY < 0) return GLib.SOURCE_CONTINUE;

                const panelHeight = Main.panel.height || 32;
                const activeWs = global.workspace_manager.get_active_workspace();
                const isTemp = this._policy.isTempWorkspace(activeWs);

                if (!isTemp) {
                    return GLib.SOURCE_REMOVE;
                }

                if (ptrY > panelHeight && !Main.panel.menuManager.activeMenu) {
                    const hideDelay = settings.get_int('topbar-hide-delay');
                    if (hideDelay > 0) {
                        if (!this._panelTimeoutId) {
                            this._panelTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, hideDelay, () => {
                                this._panelTimeoutId = 0;
                                let finalY = 1000;
                                try { const [, fy] = global.get_pointer(); finalY = fy; } catch(_) {}
                                if (finalY > panelHeight && !Main.panel.menuManager.activeMenu) {
                                    hideTopBar();
                                }
                                return GLib.SOURCE_REMOVE;
                            });
                        }
                    } else {
                        hideTopBar();
                        return GLib.SOURCE_REMOVE;
                    }
                } else {
                    if (this._panelTimeoutId) {
                        GLib.Source.remove(this._panelTimeoutId);
                        this._panelTimeoutId = 0;
                    }
                }
                return GLib.SOURCE_CONTINUE;
            });
        };

        this._topEdgeTrigger = new Clutter.Actor({
            width: 10000,
            height: 1,
            reactive: true,
            opacity: 0
        });
        Main.layoutManager.addChrome(this._topEdgeTrigger, { affectsStruts: false, trackFullscreen: true });

        this._showTimeoutId = 0;
        this._topEdgeSignal = this._topEdgeTrigger.connect('enter-event', () => {
            const activeWs = global.workspace_manager.get_active_workspace();
            if (this._policy.isTempWorkspace(activeWs)) {
                const showDelay = settings.get_int('topbar-show-delay');
                if (showDelay > 0) {
                    if (!this._showTimeoutId) {
                        this._showTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, showDelay, () => {
                            this._showTimeoutId = 0;
                            showTopBar();
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                } else {
                    showTopBar();
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._topEdgeLeaveSignal = this._topEdgeTrigger.connect('leave-event', () => {
            if (this._showTimeoutId) {
                GLib.Source.remove(this._showTimeoutId);
                this._showTimeoutId = 0;
            }
            return Clutter.EVENT_PROPAGATE;
        });



        this._policy.updateUI = () => {
            const activeWs = global.workspace_manager.get_active_workspace();
            if (this._policy.isActive && this._policy.isActive() && this._policy.isTempWorkspace(activeWs)) {
                setPanelStruts(false);
                // Clear any pending timers
                if (this._panelTimeoutId) { GLib.Source.remove(this._panelTimeoutId); this._panelTimeoutId = 0; }
                if (this._pointerTrackerId) { GLib.Source.remove(this._pointerTrackerId); this._pointerTrackerId = 0; }
                if (this._showTimeoutId) { GLib.Source.remove(this._showTimeoutId); this._showTimeoutId = 0; }

                // Check if the mouse is currently at the top edge
                let ptrY = -1;
                try { const [, y] = global.get_pointer(); ptrY = y; } catch (_) {}
                const panelHeight = Main.panel.height || 32;

                if (ptrY >= 0 && ptrY <= panelHeight) {
                    // Mouse is on the panel — keep it visible and start the tracker
                    Main.layoutManager.panelBox.remove_transition('translation_y');
                    Main.layoutManager.panelBox.translation_y = 0;
                    easeAllWindowActors(panelHeight, 0);
                    if (this._topEdgeTrigger) this._topEdgeTrigger.reactive = false;
                    showTopBar();
                } else {
                    // Mouse is away — hide the panel instantly
                    Main.layoutManager.panelBox.remove_transition('translation_y');
                    Main.layoutManager.panelBox.translation_y = -Main.layoutManager.panelBox.height;
                    easeAllWindowActors(0, 0);
                    if (this._topEdgeTrigger) this._topEdgeTrigger.reactive = true;
                }

                // Force re-maximize windows that opened already maximized.
                // Their geometry was calculated with the panel, so it's too short.
                // A small delay ensures the strut change has propagated.
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    try {
                        const ws = global.workspace_manager.get_active_workspace();
                        if (!this._policy || !this._policy.isTempWorkspace(ws)) return GLib.SOURCE_REMOVE;
                        for (const w of ws.list_windows()) {
                            if (w.maximized_horizontally && w.maximized_vertically && !w.fullscreen) {
                                w.unmaximize(Meta.MaximizeFlags.BOTH);
                                w.maximize(Meta.MaximizeFlags.BOTH);
                            }
                        }
                    } catch (_) {}
                    return GLib.SOURCE_REMOVE;
                });
                if (this._dockSettings) {
                    try {
                        if (this._dockSettings.get_boolean('dock-fixed')) {
                            this._dockWasFixed = true;
                            this._dockSettings.set_boolean('dock-fixed', false);
                        }
                        if (!this._dockSettings.get_boolean('autohide-in-fullscreen')) {
                            this._dockWasNoAutohideFS = true;
                            this._dockSettings.set_boolean('autohide-in-fullscreen', true);
                        }
                    } catch (e) {
                        this._log(`[ext] dock settings error: ${e}`);
                    }
                }
            } else {
                setPanelStruts(true);
                if (this._panelTimeoutId) { GLib.Source.remove(this._panelTimeoutId); this._panelTimeoutId = 0; }
                if (this._pointerTrackerId) { GLib.Source.remove(this._pointerTrackerId); this._pointerTrackerId = 0; }
                if (this._showTimeoutId) { GLib.Source.remove(this._showTimeoutId); this._showTimeoutId = 0; }

                // Clear any translations without animating (so we don't interfere with workspace switch animation)
                Main.layoutManager.panelBox.remove_transition('translation_y');
                Main.layoutManager.panelBox.translation_y = 0;
                easeAllWindowActors(0, 0);

                if (this._topEdgeTrigger) this._topEdgeTrigger.reactive = false;

                if (this._dockSettings) {
                    try {
                        if (this._dockWasFixed) {
                            this._dockSettings.set_boolean('dock-fixed', true);
                            this._dockWasFixed = false;
                        }
                        if (this._dockWasNoAutohideFS) {
                            this._dockSettings.set_boolean('autohide-in-fullscreen', false);
                            this._dockWasNoAutohideFS = false;
                        }
                    } catch (e) {
                        this._log(`[ext] dock settings error: ${e}`);
                    }
                }
            }
        };

        this._runtime.workspaceSignal = global.workspace_manager.connect(
            'active-workspace-changed',
            () => this._policy.updateUI()
        );

        this._syncActiveState = () => {
            const active = this._policy.isActive();
            if (!active) {
                for (const [win, state] of this._runtime.states.entries()) {
                    if (state.moved) {
                        restoreToOrigin(win, state, this._policy, false, m => this._log(m));
                    }
                }
                setPanelStruts(true);
                showTopBar();
            } else {
                normalizeFixedWorkspaceFullscreenWindows(
                    this._runtime.windowSignals,
                    this._runtime.states,
                    this._policy,
                    m => this._log(m)
                );
            }
        };

        settings.connect('changed::is-active', () => this._syncActiveState());
        settings.connect('changed::disable-auto-multi-monitor', () => this._syncActiveState());
        settings.connect('changed::disable-on-secondary-monitors', () => this._syncActiveState());

        const initialWs = global.workspace_manager.get_active_workspace();
        if (this._policy.isTempWorkspace(initialWs)) {
            this._policy.updateUI();
        }

        for (const actor of global.get_window_actors()) {
            const win = actor.get_meta_window();
            trackWindow(
                win,
                this._runtime.windowSignals,
                this._runtime.states,
                this._policy,
                m => this._log(m)
            );
        }

        normalizeFixedWorkspaceFullscreenWindows(
            this._runtime.windowSignals,
            this._runtime.states,
            this._policy,
            m => this._log(m)
        );

        this._log('[ext] activada');
    }

    /**
     * Core lifecycle hook triggered when the user turns the extension off or crashes out of the Session.
     * Flushes all active observers, UI instances, and cleanly rolls back configurations safely.
     */
    disable() {
        if (!this._runtime)
            return;

        const log = this._log;

        if (this._runtime.startupTimeoutId) {
            GLib.Source.remove(this._runtime.startupTimeoutId);
            this._runtime.startupTimeoutId = 0;
        }

        if (this._quickIndicator) {
            this._quickIndicator.quickSettingsItems.forEach(item => item.destroy());
            this._quickIndicator.destroy();
            this._quickIndicator = null;
        }

        for (const id of this._runtime.displaySignals) {
            try {
                global.display.disconnect(id);
            } catch (_) { }
        }
        this._runtime.displaySignals = [];

        if (this._runtime.monitorSignal) {
            try {
                Main.layoutManager.disconnect(this._runtime.monitorSignal);
            } catch (_) { }
            this._runtime.monitorSignal = 0;
        }

        if (this._runtime.workspaceSignal) {
            try {
                global.workspace_manager.disconnect(this._runtime.workspaceSignal);
            } catch (_) { }
            this._runtime.workspaceSignal = 0;
        }

        if (this._showTimeoutId) {
            GLib.Source.remove(this._showTimeoutId);
            this._showTimeoutId = 0;
        }

        if (this._topEdgeSignal && this._topEdgeTrigger) {
            try { this._topEdgeTrigger.disconnect(this._topEdgeSignal); } catch (_) {}
            this._topEdgeSignal = 0;
        }

        if (this._topEdgeLeaveSignal && this._topEdgeTrigger) {
            try { this._topEdgeTrigger.disconnect(this._topEdgeLeaveSignal); } catch (_) {}
            this._topEdgeLeaveSignal = 0;
        }

        if (this._topEdgeTrigger) {
            try {
                Main.layoutManager.removeChrome(this._topEdgeTrigger);
                this._topEdgeTrigger.destroy();
            } catch (_) {}
            this._topEdgeTrigger = null;
        }

        if (this._pointerTrackerId) {
            GLib.Source.remove(this._pointerTrackerId);
            this._pointerTrackerId = 0;
        }

        if (this._panelTimeoutId) {
            GLib.Source.remove(this._panelTimeoutId);
            this._panelTimeoutId = 0;
        }

        if (this._dockSettings) {
            try {
                if (this._dockWasFixed) {
                    this._dockSettings.set_boolean('dock-fixed', true);
                }
                if (this._dockWasNoAutohideFS) {
                    this._dockSettings.set_boolean('autohide-in-fullscreen', false);
                }
                if (this._dockOriginalPressure === false) {
                    this._dockSettings.set_boolean('require-pressure-to-show', false);
                }
            } catch (_) {}
            this._dockWasFixed = false;
            this._dockWasNoAutohideFS = false;
            this._dockOriginalPressure = null;
        }

        try {
            const trackData = Main.layoutManager._trackedActors.find(a => a.actor === Main.layoutManager.panelBox);
            if (trackData) {
                trackData.affectsStruts = true;
                Main.layoutManager._queueUpdateRegions();
            }
            Main.layoutManager.panelBox.remove_transition('translation_y');
            Main.layoutManager.panelBox.translation_y = 0;
            Main.panel.remove_transition('translation_y');
            Main.panel.remove_transition('opacity');
            Main.panel.translation_y = 0;
            Main.panel.opacity = 255;

            // Reset any window actor translations we applied
            const nWs = global.workspace_manager.get_n_workspaces();
            for (let i = 0; i < nWs; i++) {
                const ws = global.workspace_manager.get_workspace_by_index(i);
                for (const win of ws.list_windows()) {
                    const actor = win.get_compositor_private();
                    if (actor && actor.translation_y !== 0) {
                        actor.remove_transition('translation_y');
                        actor.translation_y = 0;
                    }
                }
            }
        } catch (_) { }

        disposeRuntimeState(this._runtime);
        this._runtime = null;
        this._policy = null;

        log?.('[ext] desactivada');
    }
}
