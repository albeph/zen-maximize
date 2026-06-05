/**
 * @file src/ui/quickToggle.js
 * @description Provides the UI component for the GNOME Quick Settings panel, allowing users to quickly toggle the extension's behavior on or off.
 */

import GObject from 'gi://GObject';
import { QuickToggle, SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js';

export const FullscreenToggle = GObject.registerClass(
class FullscreenToggle extends QuickToggle {
    _init(settings) {
        super._init({
            title: 'Zen Maximize',
            iconName: 'view-fullscreen-symbolic',
            toggleMode: true,
        });
        
        this._settings = settings;
        
        this.checked = this._settings.get_boolean('is-active');
        this.connect('clicked', () => {
            this._settings.set_boolean('is-active', this.checked);
        });
        
        this._settings.connect('changed::is-active', () => {
            this.checked = this._settings.get_boolean('is-active');
        });
    }
});

export const FullscreenIndicator = GObject.registerClass(
class FullscreenIndicator extends SystemIndicator {
    _init(settings) {
        super._init();
        this._item = new FullscreenToggle(settings);
        this.quickSettingsItems.push(this._item);
    }
});
