import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ZenMaximizePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();

        // ── General Settings ──
        const group = new Adw.PreferencesGroup({
            title: _('General Settings'),
        });

        const activeRow = new Adw.ActionRow({
            title: _('Enable Zen Maximize'),
            subtitle: _('Temporarily pause all extension behaviors.'),
        });
        const activeToggle = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind('is-active', activeToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        activeRow.add_suffix(activeToggle);
        activeRow.activatable_widget = activeToggle;
        group.add(activeRow);

        const multiMonRow = new Adw.ActionRow({
            title: _('Disable when multiple monitors are connected'),
            subtitle: _('Completely disables Zen Maximize when two or more monitors are detected.'),
        });
        const multiMonToggle = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind('disable-on-secondary-monitors', multiMonToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        multiMonRow.add_suffix(multiMonToggle);
        multiMonRow.activatable_widget = multiMonToggle;
        group.add(multiMonRow);

        const autoDisableRow = new Adw.ExpanderRow({
            title: _('Force execution even when "Workspaces on all displays" is enabled'),
            subtitle: _('Ignore the automatic deactivation and keep the extension running.'),
        });

        const autoDisableToggle = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind('disable-auto-multi-monitor', autoDisableToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        autoDisableRow.add_suffix(autoDisableToggle);

        const infoRow = new Adw.ActionRow({
            title: _('Why does the extension deactivate automatically?'),
            subtitle: _('Zen Maximize uses GNOME Workspaces to hide the top bar and maximize apps. If you connect a second monitor with "Workspaces on all displays" enabled, this conflicts with the extension logic. To avoid graphical glitches and empty desktops, the extension disables itself until you disconnect the monitor or change the GNOME setting. Enabling this toggle forces the extension to stay active, ignoring this safety check.'),
        });
        autoDisableRow.add_row(infoRow);

        group.add(autoDisableRow);

        // ── Top Bar Timing ──
        const timingGroup = new Adw.PreferencesGroup({
            title: _('Top Bar Timing'),
        });

        const showDelayRow = new Adw.SpinRow({
            title: _('Show delay (ms)'),
            subtitle: _('How long the cursor must stay at the top edge before the bar appears.'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 5000,
                step_increment: 50,
            }),
        });
        settings.bind('topbar-show-delay', showDelayRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        timingGroup.add(showDelayRow);

        const hideDelayRow = new Adw.SpinRow({
            title: _('Hide delay (ms)'),
            subtitle: _('How long the bar stays visible after the cursor leaves.'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 5000,
                step_increment: 50,
            }),
        });
        settings.bind('topbar-hide-delay', hideDelayRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        timingGroup.add(hideDelayRow);

        page.add(group);
        page.add(timingGroup);

        // ── Dock / App Bar ──
        try {
            const dockSchema = 'org.gnome.shell.extensions.dash-to-dock';
            const dockSettings = new Gio.Settings({ schema_id: dockSchema });

            const dockGroup = new Adw.PreferencesGroup({
                title: _('App Bar (Dock)'),
                description: _('These settings control how the hidden dock reappears. Pressure is the default GNOME mechanism: you must push the cursor firmly against the screen edge, rather than just hovering over it.'),
            });

            const pressureToggleRow = new Adw.ActionRow({
                title: _('Require pressure to show'),
                subtitle: _('When enabled, you must push the cursor against the edge to reveal the dock (GNOME default behavior). When disabled, the dock appears by simply hovering near the edge.'),
            });
            const pressureToggle = new Gtk.Switch({
                valign: Gtk.Align.CENTER,
            });
            settings.bind('dock-require-pressure-to-show', pressureToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
            pressureToggleRow.add_suffix(pressureToggle);
            pressureToggleRow.activatable_widget = pressureToggle;
            dockGroup.add(pressureToggleRow);

            const pressureThresholdRow = new Adw.SpinRow({
                title: _('Pressure threshold'),
                subtitle: _('Amount of cursor pressure needed against the edge to trigger the dock (default: 100).'),
                sensitive: settings.get_boolean('dock-require-pressure-to-show'),
                adjustment: new Gtk.Adjustment({
                    lower: 0,
                    upper: 500,
                    step_increment: 10,
                }),
            });
            settings.bind('dock-pressure-threshold', pressureThresholdRow, 'value', Gio.SettingsBindFlags.DEFAULT);
            dockGroup.add(pressureThresholdRow);

            // Disable threshold spinner when pressure is not required and push to dock
            settings.connect('changed::dock-require-pressure-to-show', () => {
                const required = settings.get_boolean('dock-require-pressure-to-show');
                pressureThresholdRow.sensitive = required;
                dockSettings.set_boolean('require-pressure-to-show', required);
            });
            
            settings.connect('changed::dock-pressure-threshold', () => {
                dockSettings.set_int('pressure-threshold', settings.get_int('dock-pressure-threshold'));
            });

            page.add(dockGroup);
        } catch (_) {
            // Dash to Dock / Ubuntu Dock not installed, skip
        }

        const versionGroup = new Adw.PreferencesGroup();
        const versionStr = this.metadata['version-name'] ?? this.metadata.version;
        const versionLabel = new Gtk.Label({
            label: `<span size="small" alpha="55%">Version ${versionStr}</span>`,
            use_markup: true,
            halign: Gtk.Align.CENTER,
            margin_top: 24,
            margin_bottom: 12,
        });
        versionGroup.add(versionLabel);
        page.add(versionGroup);

        window.add(page);
    }
}
