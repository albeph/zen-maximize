/**
 * @file extension.js
 * @description Entry point of the Zen Maximize extension. Handles the GNOME Shell extension lifecycle (enable/disable), UI hooks (Top Bar hiding), and quick settings integration.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
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

        this._policy.isActive = () => settings.get_boolean('is-active');

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
            () => onMonitorsChanged(
                this._runtime.windowSignals,
                this._runtime.states,
                (win, state, fromClose) =>
                    restoreToOrigin(win, state, this._policy, fromClose, m => this._log(m)),
                m => this._log(m)
            )
        );

        try {
            this._dockSettings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.dash-to-dock' });
        } catch (e) {
            this._dockSettings = null;
        }
        this._dockWasFixed = false;
        this._dockWasNoAutohideFS = false;
        this._dockWasPressure = false;
        this._panelTimeoutId = 0;

        const hideTopBar = () => {
            if (this._panelTimeoutId) {
                GLib.Source.remove(this._panelTimeoutId);
                this._panelTimeoutId = 0;
            }
            Main.panel.ease({
                translation_y: -Main.panel.height,
                opacity: 0,
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    Main.panel.hide();
                }
            });
        };

        const showTopBar = () => {
            if (this._panelTimeoutId) {
                GLib.Source.remove(this._panelTimeoutId);
                this._panelTimeoutId = 0;
            }
            Main.panel.show();
            Main.panel.ease({
                translation_y: 0,
                opacity: 255,
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });
        };

        this._topEdgeTrigger = new Clutter.Actor({
            width: 10000,
            height: 1,
            reactive: true,
            opacity: 0
        });
        Main.layoutManager.addChrome(this._topEdgeTrigger, { affectsStruts: false, trackFullscreen: true });

        this._topEdgeSignal = this._topEdgeTrigger.connect('enter-event', () => {
            const activeWs = global.workspace_manager.get_active_workspace();
            if (this._policy.isTempWorkspace(activeWs)) {
                showTopBar();
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._panelEnterSignal = Main.panel.connect('enter-event', () => {
            if (this._panelTimeoutId) {
                GLib.Source.remove(this._panelTimeoutId);
                this._panelTimeoutId = 0;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._panelLeaveSignal = Main.panel.connect('leave-event', () => {
            const activeWs = global.workspace_manager.get_active_workspace();
            if (this._policy.isTempWorkspace(activeWs) && !Main.panel.menuManager.activeMenu) {
                if (!this._panelTimeoutId) {
                    this._panelTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOP_BAR_HIDE_DELAY_MS, () => {
                        this._panelTimeoutId = 0;
                        let ptrY = 1000;
                        try {
                            const [, y] = global.get_pointer();
                            ptrY = y;
                        } catch (_) {}
                        
                        const panelHeight = Main.panel.height || 32;
                        if (ptrY > panelHeight && !Main.panel.menuManager.activeMenu) {
                            hideTopBar();
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._policy.updateUI = () => {
            const activeWs = global.workspace_manager.get_active_workspace();
            if (this._policy.isActive && this._policy.isActive() && this._policy.isTempWorkspace(activeWs)) {
                let ptrY = 1000;
                try {
                    const [, y] = global.get_pointer();
                    ptrY = y;
                } catch (_) {}
                
                const panelHeight = Main.panel.height || 32;
                if (ptrY > panelHeight) {
                    hideTopBar();
                } else {
                    showTopBar();
                }
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
                        if (this._dockSettings.get_boolean('require-pressure-to-show')) {
                            this._dockWasPressure = true;
                            this._dockSettings.set_boolean('require-pressure-to-show', false);
                        }
                    } catch (e) {
                        this._log(`[ext] dock settings error: ${e}`);
                    }
                }
            } else {
                showTopBar();
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
                        if (this._dockWasPressure) {
                            this._dockSettings.set_boolean('require-pressure-to-show', true);
                            this._dockWasPressure = false;
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

        settings.connect('changed::is-active', () => {
            const active = settings.get_boolean('is-active');
            if (!active) {
                for (const [win, state] of this._runtime.states.entries()) {
                    if (state.moved) {
                        restoreToOrigin(win, state, this._policy, false, m => this._log(m));
                    }
                }
                showTopBar();
            } else {
                normalizeFixedWorkspaceFullscreenWindows(
                    this._runtime.windowSignals,
                    this._runtime.states,
                    this._policy,
                    m => this._log(m)
                );
            }
        });

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

        if (this._topEdgeSignal && this._topEdgeTrigger) {
            try { this._topEdgeTrigger.disconnect(this._topEdgeSignal); } catch (_) {}
            this._topEdgeSignal = 0;
        }

        if (this._topEdgeTrigger) {
            try {
                Main.layoutManager.removeChrome(this._topEdgeTrigger);
                this._topEdgeTrigger.destroy();
            } catch (_) {}
            this._topEdgeTrigger = null;
        }

        if (this._panelEnterSignal) {
            try { Main.panel.disconnect(this._panelEnterSignal); } catch (_) {}
            this._panelEnterSignal = 0;
        }

        if (this._panelLeaveSignal) {
            try { Main.panel.disconnect(this._panelLeaveSignal); } catch (_) {}
            this._panelLeaveSignal = 0;
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
                if (this._dockWasPressure) {
                    this._dockSettings.set_boolean('require-pressure-to-show', true);
                }
            } catch (_) {}
            this._dockWasFixed = false;
            this._dockWasNoAutohideFS = false;
            this._dockWasPressure = false;
        }

        try {
            Main.panel.remove_transition('translation_y');
            Main.panel.remove_transition('opacity');
            Main.panel.translation_y = 0;
            Main.panel.opacity = 255;
            Main.panel.show();
        } catch (_) { }

        disposeRuntimeState(this._runtime);
        this._runtime = null;
        this._policy = null;

        log?.('[ext] desactivada');
    }
}
