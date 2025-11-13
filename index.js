// KV Cache Manager для SillyTavern
// Расширение для управления KV-кешем llama.cpp
import { eventSource, event_types } from "../../../../script.js";

import { loadSettings, createSettingsHandlers, extensionFolderPath } from './settings.js';
import { onSaveButtonClick, onSaveNowButtonClick, onLoadButtonClick, onReleaseAllSlotsButtonClick, onSaveSlotButtonClick, onPreloadCharactersButtonClick } from './ui/ui.js';
import { initializeSlots, updateSlotsList, redistributeCharacters, initializePreviousChatId } from './core/slot-manager.js';
import { processMessageForAutoSave } from './core/auto-save.js';
// Импорты из load-popup.js больше не нужны для index.js, так как popup теперь управляется через callGenericPopup
import { KVCacheManagerInterceptor, setSlotForGeneration } from './interceptors/generation-interceptor.js';

// Функция вызывается при загрузке расширения
jQuery(async () => {
    // Загружаем HTML из файлов
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $("#extensions_settings").append(settingsHtml);

    // Загружаем настройки при старте
    await loadSettings();
    await initializeSlots();
    initializePreviousChatId();
    
    // Регистрируем функцию-перехватчик в глобальном объекте
    window['KVCacheManagerInterceptor'] = KVCacheManagerInterceptor;
    
    // Обновляем список слотов при запуске генерации
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, updateSlotsList);
    eventSource.on(event_types.TEXT_COMPLETION_SETTINGS_READY, setSlotForGeneration);
    eventSource.on(event_types.MESSAGE_RECEIVED, processMessageForAutoSave);
    eventSource.on(event_types.CHAT_CHANGED, redistributeCharacters);

    // Настраиваем обработчики событий для изменения настроек
    const settingsHandlers = createSettingsHandlers();
    $("#kv-cache-enabled").on("input", settingsHandlers.onEnabledChange);
    $("#kv-cache-save-interval").on("input", settingsHandlers.onSaveIntervalChange);
    $("#kv-cache-max-files").on("input", settingsHandlers.onMaxFilesChange);
    $("#kv-cache-show-notifications").on("input", settingsHandlers.onShowNotificationsChange);
    $("#kv-cache-clear-on-chat-change").on("input", settingsHandlers.onClearOnChatChangeChange);
    $("#kv-cache-preload-timeout").on("input", settingsHandlers.onPreloadTimeoutChange);
    
    // Обработчики для кнопок
    $("#kv-cache-save-button").on("click", onSaveButtonClick);
    $("#kv-cache-load-button").on("click", onLoadButtonClick);
    $("#kv-cache-save-now-button").on("click", onSaveNowButtonClick);
    $("#kv-cache-preload-characters-button").on("click", onPreloadCharactersButtonClick);
    $("#kv-cache-release-all-slots-button").on("click", onReleaseAllSlotsButtonClick);
    
    // Обработчик для кнопок сохранения слотов (делегирование для динамических элементов)
    $(document).on("click", ".kv-cache-save-slot-button", onSaveSlotButtonClick);
    
});
