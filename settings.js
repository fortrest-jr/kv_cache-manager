// Управление настройками для KV Cache Manager

import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { showToast } from './ui/ui.js';
import { updateSlotsList } from './core/slot-manager.js';

// Имя расширения должно совпадать с именем папки
export const extensionName = "kv_cache-manager";
export const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

export const defaultSettings = {
    enabled: true,
    saveInterval: 5,
    maxFiles: 10,
    showNotifications: true,
    clearOnChatChange: true,
    preloadTimeout: 20
};

// Константы для валидации файлов
export const MIN_FILE_SIZE_MB = 1; // Минимальный размер файла кеша в МБ (файлы меньше этого размера считаются невалидными)
export const FILE_CHECK_DELAY_MS = 500; // Задержка перед проверкой размера файла после сохранения (мс)

// Константы для использования слотов
export const MIN_USAGE_FOR_SAVE = 1; // Минимальное количество использований слота для сохранения кеша

// Таймауты для llama.cpp API (в миллисекундах)
export const LLAMA_API_TIMEOUTS = {
    GET_SLOTS: 10000,           // 10 секунд
    SAVE_CACHE: 300000,          // 5 минут
    LOAD_CACHE: 300000,          // 5 минут
    CLEAR_CACHE: 30000           // 30 секунд
};

// Таймауты для file plugin API (в миллисекундах)
export const FILE_PLUGIN_API_TIMEOUTS = {
    CSRF_TOKEN: 5000,            // 5 секунд
    GET_FILES: 10000,            // 10 секунд
    DELETE_FILE: 10000           // 10 секунд
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
    $("#kv-cache-preload-timeout").val(extensionSettings.preloadTimeout).trigger("input");
    
    // Обновляем список слотов
    updateSlotsList();
}

// Обработчики для чекбоксов и полей ввода
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
        showToast('success', `Уведомления ${value ? 'включены' : 'отключены'}`);
    }
    
    function onClearOnChatChangeChange(event) {
        const value = Boolean($(event.target).prop("checked"));
        extensionSettings.clearOnChatChange = value;
        saveSettingsDebounced();
        showToast('success', `Очистка при смене чата ${value ? 'включена' : 'отключена'}`);
    }
    
    function onPreloadTimeoutChange(event) {
        const value = parseInt($(event.target).val());
        extensionSettings.preloadTimeout = value;
        saveSettingsDebounced();
    }
    
    return {
        onEnabledChange,
        onSaveIntervalChange,
        onMaxFilesChange,
        onShowNotificationsChange,
        onClearOnChatChangeChange,
        onPreloadTimeoutChange
    };
}

