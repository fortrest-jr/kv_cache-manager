// KV Cache Manager для SillyTavern
// Расширение для управления KV-кешем llama.cpp
import { eventSource, event_types } from "../../../../script.js";

import { loadSettings, createSettingsHandlers } from './settings.js';
import { onSaveButtonClick, onSaveNowButtonClick, onLoadButtonClick, onReleaseAllSlotsButtonClick, onSaveSlotButtonClick, showToast } from './ui.js';
import { initializeSlots, updateSlotsList, redistributeCharacters, initializePreviousChatId } from './slot-manager.js';
import { updateNextSaveIndicator, processMessageForAutoSave } from './auto-save.js';
import { closeLoadModal, selectLoadModalChat, loadSelectedCache, updateSearchQuery } from './load-modal.js';
import { KVCacheManagerInterceptor, setSlotForGeneration } from './generation-interceptor.js';

// Имя расширения должно совпадать с именем папки
const extensionName = "kv_cache-manager";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// Функция вызывается при загрузке расширения
jQuery(async () => {
    console.log('[KV Cache Manager] Начало загрузки расширения...');
    console.log('[KV Cache Manager] jQuery готов, начинаем инициализацию');
    
    try {
        // Принудительно показываем тосты при загрузке (force = true)
        showToast('info', 'Начало загрузки расширения...', 'Загрузка', true);
        
        console.log('[KV Cache Manager] Проверка наличия toastr:', typeof toastr);
        console.log('[KV Cache Manager] Проверка наличия jQuery:', typeof $);
        console.log('[KV Cache Manager] Проверка наличия extension_settings:', typeof extension_settings);
        
        // Загружаем HTML из файла
        console.log('[KV Cache Manager] Загрузка HTML из:', `${extensionFolderPath}/settings.html`);
        showToast('info', 'Загрузка HTML настроек...', 'Загрузка', true);
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        console.log('[KV Cache Manager] HTML загружен, длина:', settingsHtml.length);
        
        // Проверяем, что контейнер существует
        const $extensionsSettings = $("#extensions_settings");
        console.log('[KV Cache Manager] Поиск #extensions_settings, найдено элементов:', $extensionsSettings.length);
        if ($extensionsSettings.length === 0) {
            showToast('error', 'Контейнер #extensions_settings не найден', 'Загрузка', true);
            console.error('[KV Cache Manager] Контейнер #extensions_settings не найден');
            console.error('[KV Cache Manager] Доступные элементы с id extensions:', $('[id*="extension"]').length);
            return;
        }
        
        showToast('info', 'Добавление HTML в DOM...', 'Загрузка', true);
        $extensionsSettings.append(settingsHtml);
        console.log('[KV Cache Manager] HTML добавлен в DOM');
        
        // Проверяем, что HTML был добавлен
        const $kvCacheEnabled = $("#kv-cache-enabled");
        console.log('[KV Cache Manager] Поиск #kv-cache-enabled, найдено элементов:', $kvCacheEnabled.length);
        if ($kvCacheEnabled.length === 0) {
            showToast('error', 'HTML настроек не был добавлен в DOM', 'Загрузка', true);
            console.error('[KV Cache Manager] HTML настроек не был добавлен в DOM');
            console.error('[KV Cache Manager] Содержимое #extensions_settings:', $extensionsSettings.html().substring(0, 200));
            return;
        }
        
        showToast('info', 'Загрузка настроек...', 'Загрузка', true);
        await loadSettings();
        console.log('[KV Cache Manager] Настройки загружены');
        showToast('success', 'Настройки загружены', 'Загрузка', true);
        
        showToast('info', 'Инициализация слотов...', 'Загрузка', true);
        await initializeSlots();
        console.log('[KV Cache Manager] Слоты инициализированы');
        showToast('success', 'Слоты инициализированы', 'Загрузка', true);
        
        showToast('info', 'Инициализация предыдущего чата...', 'Загрузка', true);
        initializePreviousChatId();
        console.log('[KV Cache Manager] Предыдущий чат инициализирован');
        
        showToast('info', 'Обновление индикаторов...', 'Загрузка', true);
        updateNextSaveIndicator();
        console.log('[KV Cache Manager] Индикаторы обновлены');
        
        showToast('info', 'Регистрация перехватчика генерации...', 'Загрузка', true);
        // Регистрируем функцию-перехватчик в глобальном объекте
        window['KVCacheManagerInterceptor'] = KVCacheManagerInterceptor;
        console.log('[KV Cache Manager] Перехватчик зарегистрирован');
        
        showToast('info', 'Регистрация обработчиков событий...', 'Загрузка', true);
        // Обновляем список слотов при запуске генерации
        eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, updateSlotsList);
        eventSource.on(event_types.TEXT_COMPLETION_SETTINGS_READY, setSlotForGeneration);
        eventSource.on(event_types.MESSAGE_RECEIVED, processMessageForAutoSave);
        eventSource.on(event_types.CHAT_CHANGED, redistributeCharacters);
        console.log('[KV Cache Manager] Обработчики событий зарегистрированы');

        // Настраиваем обработчики событий для изменения настроек
        const settingsHandlers = createSettingsHandlers();
        $("#kv-cache-enabled").on("input", settingsHandlers.onEnabledChange);
        $("#kv-cache-save-interval").on("input", settingsHandlers.onSaveIntervalChange);
        $("#kv-cache-max-files").on("input", settingsHandlers.onMaxFilesChange);
        $("#kv-cache-show-notifications").on("input", settingsHandlers.onShowNotificationsChange);
        $("#kv-cache-clear-on-chat-change").on("input", settingsHandlers.onClearOnChatChangeChange);
        console.log('[KV Cache Manager] Обработчики настроек зарегистрированы');
        
        // Обработчики для кнопок
        $("#kv-cache-save-button").on("click", onSaveButtonClick);
        $("#kv-cache-load-button").on("click", onLoadButtonClick);
        $("#kv-cache-save-now-button").on("click", onSaveNowButtonClick);
        console.log('[KV Cache Manager] Обработчики кнопок зарегистрированы');
        
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
        
        showToast('success', 'Расширение успешно загружено!', 'Загрузка', true);
        console.log('[KV Cache Manager] Расширение успешно загружено');
        
    } catch (error) {
        showToast('error', `Ошибка при загрузке: ${error.message}`, 'Загрузка', true);
        console.error('[KV Cache Manager] Ошибка при загрузке расширения:', error);
        console.error('[KV Cache Manager] Стек ошибки:', error.stack);
    }
});
