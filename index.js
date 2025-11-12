// KV Cache Manager для SillyTavern
// Расширение для управления KV-кешем llama.cpp

// Импортируем необходимые функции из SillyTavern
import { eventSource, event_types } from "../../../../script.js";

// Импортируем модули
import { getExtensionSettings, loadSettings, createSettingsHandlers } from './settings.js';
import { getNormalizedChatId } from './utils.js';
import { onSaveButtonClick, onSaveNowButtonClick, onLoadButtonClick, onReleaseAllSlotsButtonClick, onSaveSlotButtonClick } from './ui.js';
import { initializeSlots, assignCharactersToSlots, updateSlotsList, handleChatChange } from './slot-manager.js';
import { updateNextSaveIndicator, incrementMessageCounter } from './auto-save.js';
import { closeLoadModal, selectLoadModalChat, loadSelectedCache, updateSearchQuery } from './load-modal.js';
import { KVCacheManagerInterceptor, getCurrentSlot, getNormalizedCharacterNameFromData } from './generation-interceptor.js';

// Имя расширения должно совпадать с именем папки
const extensionName = "kv_cache-manager";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// Переменная для отслеживания предыдущего чата
let previousChatId = 'unknown';

// Функция вызывается при загрузке расширения
jQuery(async () => {
    // Загружаем HTML из файла
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $("#extensions_settings").append(settingsHtml);

    // Загружаем настройки при старте
    await loadSettings();
    await initializeSlots();
    
    // Инициализируем previousChatId как 'unknown' при старте
    // previousChatId больше никогда не будет присвоен 'unknown'
    previousChatId = 'unknown';
    
    updateNextSaveIndicator();
    
    // Обновляем список слотов при запуске генерации
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, async () => {
        updateSlotsList();
    });
    
    // Обработчик для установки id_slot
    eventSource.on(event_types.TEXT_COMPLETION_SETTINGS_READY, (params) => {
        const currentSlot = getCurrentSlot();
        if (currentSlot !== null) {
            params["id_slot"] = currentSlot;
            console.debug(`[KV Cache Manager] Установлен id_slot = ${currentSlot} для генерации`);
        }
    });
    
    // Регистрируем функцию-перехватчик в глобальном объекте
    window['KVCacheManagerInterceptor'] = KVCacheManagerInterceptor;
    
    // Подписка на событие получения сообщения для автосохранения
    eventSource.on(event_types.MESSAGE_RECEIVED, async (data) => {
        // Получаем нормализованное имя персонажа из данных события
        const characterName = getNormalizedCharacterNameFromData(data);
        await incrementMessageCounter(characterName);
    });
    
    // Подписка на событие переключения чата для автозагрузки
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        const currentChatId = getNormalizedChatId();
        const previousChatIdNormalized = previousChatId;
        const extensionSettings = getExtensionSettings();
        
        // Обновляем previousChatId для следующего события (никогда не присваиваем 'unknown')
        if (currentChatId !== 'unknown') {
            previousChatId = currentChatId;
        }
        
        // Обрабатываем смену чата
        await handleChatChange(previousChatIdNormalized, currentChatId, extensionSettings);
    });
    
    // При переключении чата счетчик не сбрасывается - каждый чат имеет свой независимый счетчик
    // Счетчик автоматически создается при первом сообщении в новом чате

    // Настраиваем обработчики событий для настроек
    const settingsHandlers = createSettingsHandlers();
    $("#kv-cache-enabled").on("input", settingsHandlers.onEnabledChange);
    $("#kv-cache-save-interval").on("input", settingsHandlers.onSaveIntervalChange);
    $("#kv-cache-max-files").on("input", settingsHandlers.onMaxFilesChange);
    $("#kv-cache-show-notifications").on("input", settingsHandlers.onShowNotificationsChange);
    $("#kv-cache-clear-on-chat-change").on("input", settingsHandlers.onClearOnChatChangeChange);
    
    // Обработчики для кнопок
    $("#kv-cache-save-button").on("click", onSaveButtonClick);
    $("#kv-cache-load-button").on("click", onLoadButtonClick);
    $("#kv-cache-save-now-button").on("click", onSaveNowButtonClick);
    
    // Кнопка предзагрузки пока не реализована - отключаем
    $("#kv-cache-preload-characters-button")
        .prop("disabled", true)
        .attr("title", "Функция пока не реализована");
    
    $("#kv-cache-release-all-slots-button").on("click", onReleaseAllSlotsButtonClick);
    
    // Обработчик для кнопок сохранения слотов (делегирование для динамических элементов)
    $(document).on("click", ".kv-cache-save-slot-button", onSaveSlotButtonClick);
    
    // Обработчики для модалки загрузки (используем делегирование для динамических элементов)
    $(document).on("click", "#kv-cache-load-modal-close", closeLoadModal);
    $(document).on("click", "#kv-cache-load-cancel-button", closeLoadModal);
    $(document).on("click", "#kv-cache-load-confirm-button", loadSelectedCache);
    
    // Обработчик для текущего чата (делегирование)
    $(document).on("click", ".kv-cache-load-chat-item-current", function() {
        selectLoadModalChat('current');
    });
    
    // Обработчик поиска
    $(document).on("input", "#kv-cache-load-search-input", function() {
        const query = $(this).val();
        updateSearchQuery(query);
    });
    
    // Закрытие модалки по клику вне её области
    $(document).on("click", "#kv-cache-load-modal", function(e) {
        if ($(e.target).is("#kv-cache-load-modal")) {
            closeLoadModal();
        }
    });
    
    // Закрытие модалки по Escape
    $(document).on("keydown", function(e) {
        if (e.key === "Escape" && $("#kv-cache-load-modal").is(":visible")) {
            closeLoadModal();
        }
    });
    
});
