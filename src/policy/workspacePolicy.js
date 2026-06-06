/**
 * @file src/policy/workspacePolicy.js
 * @description Defines the core rules and logic for managing temporary workspaces. Tracks which workspaces are 'temporary' (used by a maximized app) vs 'fixed' (normal user workspaces).
 */

import { FIXED_WORKSPACE_COUNT } from '../core/constants.js';

/**
 * Ruleset engine enforcing the "Static Roots + Dynamic Ephemerals" paradigm.
 * Instructs other managers on what dimensions are safe, fixed, or temporary.
 */
export class WorkspacePolicy {
    constructor(log, fixedWorkspaceCount = FIXED_WORKSPACE_COUNT) {
        this._log = log;
        this._fixedWorkspaceCount = fixedWorkspaceCount;
        this._tempWorkspaces = new Set();
    }

    /**
     * Now relies natively on dynamic workspaces. Simply prunes our internal tracked temp workspaces.
     */
    ensureFixedWorkspaces() {
        this._pruneTempWorkspaces();
    }

    getFixedWorkspaceCount() {
        return this._fixedWorkspaceCount;
    }

    /**
     * Determines whether the evaluated native index resides inside the protected root boundary.
     * @param {Meta.Workspace} workspace - Dimension evaluation target.
     * @returns {boolean} True if the workspace is permanent.
     */
    isFixedWorkspace(workspace) {
        if (!workspace)
            return false;

        const index = workspace.index();
        return index >= 0 && index < this._fixedWorkspaceCount;
    }

    /**
     * Evaluates if the given workspace is explicitly tagged as a temporary tracking dimension.
     * @param {Meta.Workspace} workspace - Virtual environment array.
     * @returns {boolean} True if the system spawned it for Fullscreen isolation.
     */
    isTempWorkspace(workspace) {
        if (!workspace)
            return false;

        this._pruneTempWorkspaces();
        return this._tempWorkspaces.has(workspace);
    }

    /**
     * Checks if any temporary workspaces currently exist.
     * @returns {boolean} True if at least one temp workspace is registered.
     */
    hasAnyTempWorkspace() {
        this._pruneTempWorkspaces();
        return this._tempWorkspaces.size > 0;
    }

    /**
     * Memorizes an ephemeral dimensional ID logic preventing accidental early garbage collection.
     * @param {Meta.Workspace} workspace - Memory footprint target.
     */
    registerTempWorkspace(workspace) {
        if (!workspace)
            return;

        this._tempWorkspaces.add(workspace);
        this._log(`[policy] temp registrado ws:${workspace.index()}`);
    }

    /**
     * Purges an ephemeral workspace from the internal retention log.
     * @param {Meta.Workspace} workspace - Footprint to delete.
     */
    unregisterTempWorkspace(workspace) {
        if (!workspace)
            return;

        this._tempWorkspaces.delete(workspace);
    }

    /**
     * Resolves the primary fallback destination. Usually Workspace index 0.
     * @returns {Meta.Workspace} Primary root environment.
     */
    getPrimaryFixedWorkspace() {
        this.ensureFixedWorkspaces();
        return global.workspace_manager.get_workspace_by_index(0);
    }

    getDefaultOriginWorkspace() {
        return this.getPrimaryFixedWorkspace();
    }

    getFixedWorkspaceForNewWindows() {
        return this.getPrimaryFixedWorkspace();
    }

    /**
     * Injects a raw unpopulated namespace into Mutter logically above the final current dimension.
     * Registers the environment dynamically allowing applications to disperse globally.
     * @param {Meta.Workspace} originWorkspace - The root workspace we're dispersing away from.
     * @returns {Meta.Workspace} Fresh ephemeral dimension.
     */
    allocateTempWorkspace(originWorkspace = null) {
        this.ensureFixedWorkspaces();

        const wm = global.workspace_manager;
        const ws = wm.append_new_workspace(false, global.get_current_time());

        if (originWorkspace && typeof wm.reorder_workspace === 'function') {
            const targetIndex = originWorkspace.index() + 1;
            if (ws.index() !== targetIndex) {
                wm.reorder_workspace(ws, targetIndex);
            }
        }


        const idx = ws.index();
        this._log(
            `[policy] temp CREADO ws:${idx} origin:${originWorkspace?.index?.() ?? 0}`
        );

        this._tempWorkspaces.add(ws);
        return ws;
    }

    /**
     * Aligns the strict application bounds with current GNOME Mutter counts preventing UI desync.
     */
    syncConfiguredWorkspaceCount() {
        this._pruneTempWorkspaces();
    }

    /**
     * Clears internal Set mappings if GNOME physically killed the Workspace via a manual close.
     * @private
     */
    _pruneTempWorkspaces() {
        const wm = global.workspace_manager;
        const alive = new Set();

        for (let i = 0; i < wm.get_n_workspaces(); i++)
            alive.add(wm.get_workspace_by_index(i));

        for (const ws of [...this._tempWorkspaces]) {
            if (!alive.has(ws))
                this._tempWorkspaces.delete(ws);
        }
    }
}

export function createWorkspacePolicy(log) {
    return new WorkspacePolicy(log);
}
