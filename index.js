import { eventSource, event_types } from "../../../../script.js";

import { loadSettings, createSettingsHandlers, extensionFolderPath, getExtensionSettings } from './settings.js';
import { onSaveButtonClick, onSaveNowButtonClick, onLoadButtonClick, onReleaseAllSlotsButtonClick, onSaveSlotButtonClick, onPreloadCharactersButtonClick } from './ui/ui.js';
import { initializeSlots, updateSlotsList, redistributeCharacters, initializePreviousChatId } from './core/slot-manager.js';
import { processMessageForAutoSave } from './core/auto-save.js';
import { KVCacheManagerInterceptor, setSlotForGeneration } from './interceptors/generation-interceptor.js';
import { startHeartbeat } from './core/heartbeat.js';

jQuery(async () => {
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $("#extensions_settings").append(settingsHtml);

    await loadSettings();
    await initializeSlots();
    initializePreviousChatId();
    
    window['KVCacheManagerInterceptor'] = KVCacheManagerInterceptor;
    
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, updateSlotsList);
    eventSource.on(event_types.TEXT_COMPLETION_SETTINGS_READY, setSlotForGeneration);
    eventSource.on(event_types.MESSAGE_RECEIVED, processMessageForAutoSave);
    eventSource.on(event_types.CHAT_CHANGED, redistributeCharacters);

    const settingsHandlers = createSettingsHandlers();
    $("#kv-cache-enabled").on("input", settingsHandlers.onEnabledChange);
    $("#kv-cache-save-interval").on("input", settingsHandlers.onSaveIntervalChange);
    $("#kv-cache-max-files").on("input", settingsHandlers.onMaxFilesChange);
    $("#kv-cache-show-notifications").on("input", settingsHandlers.onShowNotificationsChange);
    $("#kv-cache-clear-on-chat-change").on("input", settingsHandlers.onClearOnChatChangeChange);
    $("#kv-cache-preload-timeout").on("input", settingsHandlers.onPreloadTimeoutChange);
    $("#kv-cache-heartbeat").on("input", settingsHandlers.onHeartbeatChange);
    $("#kv-cache-show-heartbeat-notifications").on("input", settingsHandlers.onShowHeartbeatNotificationsChange);
    
    $("#kv-cache-save-button").on("click", onSaveButtonClick);
    $("#kv-cache-load-button").on("click", onLoadButtonClick);
    $("#kv-cache-save-now-button").on("click", onSaveNowButtonClick);
    $("#kv-cache-preload-characters-button").on("click", onPreloadCharactersButtonClick);
    $("#kv-cache-release-all-slots-button").on("click", onReleaseAllSlotsButtonClick);
    
    // Delegation for dynamic elements
    $(document).on("click", ".kv-cache-save-slot-button", onSaveSlotButtonClick);
    
    // Start heartbeat if enabled (value > 0)
    const extensionSettings = getExtensionSettings();
    if (extensionSettings.heartbeat && extensionSettings.heartbeat > 0) {
        startHeartbeat();
    }
    
});
