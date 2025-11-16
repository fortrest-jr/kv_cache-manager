import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { showToast } from './ui/ui.js';
import { updateSlotsList } from './core/slot-manager.js';
import { startHeartbeat, stopHeartbeat } from './core/heartbeat.js';

export const extensionName = "kv_cache-manager";
export const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

export const defaultSettings = {
    enabled: true,
    saveInterval: 5,
    maxFiles: 10,
    showNotifications: true,
    clearOnChatChange: true,
    preloadTimeout: 20,
    heartbeat: 0
};

export const MIN_FILE_SIZE_MB = 1;
export const FILE_CHECK_DELAY_MS = 500;

export const MIN_USAGE_FOR_SAVE = 1;

export const LLAMA_API_TIMEOUTS = {
    GET_SLOTS: 10000,
    SAVE_CACHE: 300000,
    LOAD_CACHE: 300000,
    CLEAR_CACHE: 30000
};

export const FILE_PLUGIN_API_TIMEOUTS = {
    CSRF_TOKEN: 5000,
    GET_FILES: 10000,
    DELETE_FILE: 10000
};

export function getExtensionSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }
    return extension_settings[extensionName];
}

export async function loadSettings() {
    const extensionSettings = getExtensionSettings();
    
    for (const key in defaultSettings) {
        if (!(key in extensionSettings)) {
            extensionSettings[key] = defaultSettings[key];
        }
    }
    
    $("#kv-cache-enabled").prop("checked", extensionSettings.enabled).trigger("input");
    $("#kv-cache-save-interval").val(extensionSettings.saveInterval).trigger("input");
    $("#kv-cache-max-files").val(extensionSettings.maxFiles).trigger("input");
    $("#kv-cache-show-notifications").prop("checked", extensionSettings.showNotifications).trigger("input");
    $("#kv-cache-clear-on-chat-change").prop("checked", extensionSettings.clearOnChatChange).trigger("input");
    $("#kv-cache-preload-timeout").val(extensionSettings.preloadTimeout).trigger("input");
    $("#kv-cache-heartbeat").val(extensionSettings.heartbeat).trigger("input");
    
    updateSlotsList();
}

export function createSettingsHandlers() {
    const extensionSettings = getExtensionSettings();
    
    function onEnabledChange(event) {
        const value = Boolean($(event.target).prop("checked"));
        extensionSettings.enabled = value;
        saveSettingsDebounced();
    }
    
    function onSaveIntervalChange(event) {
        const value = parseInt($(event.target).val()) || 5;
        extensionSettings.saveInterval = value;
        saveSettingsDebounced();
    }
    
    function onMaxFilesChange(event) {
        const value = parseInt($(event.target).val()) || 10;
        extensionSettings.maxFiles = value;
        saveSettingsDebounced();
    }
    
    function onShowNotificationsChange(event) {
        const value = Boolean($(event.target).prop("checked"));
        extensionSettings.showNotifications = value;
        saveSettingsDebounced();
        const status = value ? t`enabled` : t`disabled`;
        showToast('success', t`Notifications ${status}`);
    }
    
    function onClearOnChatChangeChange(event) {
        const value = Boolean($(event.target).prop("checked"));
        extensionSettings.clearOnChatChange = value;
        saveSettingsDebounced();
        const status = value ? t`enabled` : t`disabled`;
        showToast('success', t`Clear on chat change ${status}`);
    }
    
    function onPreloadTimeoutChange(event) {
        const value = parseInt($(event.target).val());
        extensionSettings.preloadTimeout = value;
        saveSettingsDebounced();
    }
    
    function onHeartbeatChange(event) {
        const value = parseInt($(event.target).val());
        extensionSettings.heartbeat = value;
        saveSettingsDebounced();
        
        if (value > 0) {
            startHeartbeat();
        } else {
            stopHeartbeat();
        }
    }
    
    return {
        onEnabledChange,
        onSaveIntervalChange,
        onMaxFilesChange,
        onShowNotificationsChange,
        onClearOnChatChangeChange,
        onPreloadTimeoutChange,
        onHeartbeatChange
    };
}

