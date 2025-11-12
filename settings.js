// Управление настройками для KV Cache Manager

import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { showToast } from './ui.js';
import { updateNextSaveIndicator } from './auto-save.js';
import { updateSlotsList } from './slot-manager.js';

// Имя расширения должно совпадать с именем папки
export const extensionName = "kv_cache-manager";
export const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

export const defaultSettings = {
    enabled: true,
    saveInterval: 5,
    maxFiles: 10,
    showNotifications: true,
    clearOnChatChange: true
};

// Получение объекта настроек расширения
export function getExtensionSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }
    return extension_settings[extensionName];
}

// Загрузка настроек
export async function loadSettings() {
    const extensionSettings = getExtensionSettings();
    
    // Убеждаемся, что все поля из defaultSettings инициализированы
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
    
    // Обновляем индикатор и список слотов
    updateNextSaveIndicator();
    updateSlotsList();
}

// Обработчики для чекбоксов и полей ввода
export function createSettingsHandlers() {
    const extensionSettings = getExtensionSettings();
    
    function onEnabledChange(event) {
        const value = Boolean($(event.target).prop("checked"));
        extensionSettings.enabled = value;
        saveSettingsDebounced();
        updateNextSaveIndicator();
    }
    
    function onSaveIntervalChange(event) {
        const value = parseInt($(event.target).val()) || 5;
        extensionSettings.saveInterval = value;
        saveSettingsDebounced();
        updateNextSaveIndicator();
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
        showToast('success', `Уведомления ${value ? 'включены' : 'отключены'}`);
    }
    
    function onClearOnChatChangeChange(event) {
        const value = Boolean($(event.target).prop("checked"));
        extensionSettings.clearOnChatChange = value;
        saveSettingsDebounced();
        showToast('success', `Очистка при смене чата ${value ? 'включена' : 'отключена'}`);
    }
    
    return {
        onEnabledChange,
        onSaveIntervalChange,
        onMaxFilesChange,
        onShowNotificationsChange,
        onClearOnChatChangeChange
    };
}

