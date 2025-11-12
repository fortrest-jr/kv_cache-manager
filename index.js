// KV Cache Manager для SillyTavern
// Расширение для управления KV-кешем llama.cpp

// Импортируем необходимые функции из SillyTavern
import { eventSource, event_types } from "../../../../script.js";

// Импортируем модули
import { getExtensionSettings, loadSettings, createSettingsHandlers } from './settings.js';
import { getNormalizedChatId } from './utils.js';
import { showToast } from './ui.js';
import { initializeSlots, assignCharactersToSlots, updateSlotsList, getSlotsState } from './slot-manager.js';
import { saveCache, saveCharacterCache, clearAllSlotsCache } from './cache-operations.js';
import { updateNextSaveIndicator, incrementMessageCounter, resetChatCounters } from './auto-save.js';
import { openLoadModal, closeLoadModal, selectLoadModalChat, renderLoadModalChats, renderLoadModalFiles, loadSelectedCache, updateSearchQuery } from './load-modal.js';
import { KVCacheManagerInterceptor, getCurrentSlot, getNormalizedCharacterNameFromData } from './generation-interceptor.js';

// Имя расширения должно совпадать с именем папки
const extensionName = "kv_cache-manager";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// Константы
const MIN_USAGE_FOR_SAVE = 2; // Минимальное количество использований слота для сохранения кеша перед вытеснением

// Переменная для отслеживания предыдущего чата
let previousChatId = 'unknown';

// Создаем колбэки для связи модулей
function createCallbacks() {
    return {
        onShowToast: (type, message, title) => showToast(type, message, title, { getExtensionSettings }),
        onUpdateNextSaveIndicator: () => updateNextSaveIndicator({ getExtensionSettings }),
        onUpdateSlotsList: () => updateSlotsList({ onShowToast: (type, message, title) => showToast(type, message, title, { getExtensionSettings }) }),
        getExtensionSettings,
        onSaveCharacterCache: async (characterName, slotIndex) => {
            return await saveCharacterCache(characterName, slotIndex, {
                onShowToast: (type, message, title) => showToast(type, message, title, { getExtensionSettings }),
                getExtensionSettings
            });
        }
    };
}

// Сохранение кеша для всех персонажей, которые находятся в слотах
// Используется перед очисткой слотов при смене чата
async function saveAllSlotsCache(callbacks) {
    const slotsState = getSlotsState();
    const totalSlots = slotsState.length;
    
    // Сохраняем кеш для всех персонажей, которые были в слотах перед очисткой
    // Важно: дожидаемся завершения сохранения перед очисткой слотов, чтобы избежать потери данных
    for (let i = 0; i < totalSlots; i++) {
        const slot = slotsState[i];
        const currentCharacter = slot?.characterName;
        if (currentCharacter && typeof currentCharacter === 'string') {
            const usageCount = slot.usage || 0;
            
            // Сохраняем кеш перед вытеснением только если персонаж использовал слот минимум 2 раза
            if (usageCount >= MIN_USAGE_FOR_SAVE) {
                await callbacks.onSaveCharacterCache(currentCharacter, i);
            } else {
                console.debug(`[KV Cache Manager] Пропускаем сохранение кеша для ${currentCharacter} (использование: ${usageCount} < ${MIN_USAGE_FOR_SAVE})`);
            }
        }
    }
}

// Обработчики для кнопок
async function onSaveButtonClick(callbacks) {
    await saveCache(true, callbacks);
}

async function onSaveNowButtonClick(callbacks) {
    const success = await saveCache(false, callbacks);
    if (success) {
        // Сбрасываем счётчики всех персонажей текущего чата после успешного сохранения
        const chatId = getNormalizedChatId();
        resetChatCounters(chatId);
        updateNextSaveIndicator(callbacks);
    }
}

async function onLoadButtonClick(callbacks) {
    await openLoadModal(callbacks);
}

async function onReleaseAllSlotsButtonClick(callbacks) {
    await initializeSlots(callbacks);
    callbacks.onShowToast('success', 'Все слоты освобождены', 'Режим групповых чатов');
}

// Сохранение кеша для конкретного слота
async function onSaveSlotButtonClick(event, callbacks) {
    const button = $(event.target).closest('.kv-cache-save-slot-button');
    const slotIndex = parseInt(button.data('slot-index'));
    const characterName = button.data('character-name');
    
    if (isNaN(slotIndex) || !characterName) {
        callbacks.onShowToast('error', 'Ошибка: неверные данные слота', 'Сохранение слота');
        return;
    }
    
    // Проверяем, что слот действительно занят этим персонажем
    // characterName из data-атрибута уже нормализован (хранится в slotsState)
    const slotsState = getSlotsState();
    const slot = slotsState[slotIndex];
    if (!slot || !slot.characterName || slot.characterName !== characterName) {
        callbacks.onShowToast('error', 'Персонаж не найден в этом слоте', 'Сохранение слота');
        return;
    }
    
    // Временно отключаем кнопку
    button.prop('disabled', true);
    const originalTitle = button.attr('title');
    button.attr('title', 'Сохранение...');
    
    try {
        callbacks.onShowToast('info', `Сохранение кеша для ${characterName}...`, 'Сохранение слота');
        const success = await callbacks.onSaveCharacterCache(characterName, slotIndex);
        
        if (success) {
            callbacks.onShowToast('success', `Кеш для ${characterName} успешно сохранен`, 'Сохранение слота');
        } else {
            callbacks.onShowToast('error', `Не удалось сохранить кеш для ${characterName}`, 'Сохранение слота');
        }
    } catch (e) {
        console.error(`[KV Cache Manager] Ошибка при сохранении слота ${slotIndex}:`, e);
        callbacks.onShowToast('error', `Ошибка при сохранении: ${e.message}`, 'Сохранение слота');
    } finally {
        // Включаем кнопку обратно
        button.prop('disabled', false);
        button.attr('title', originalTitle);
    }
}

// Функция вызывается при загрузке расширения
jQuery(async () => {
    // Создаем колбэки
    const callbacks = createCallbacks();
    
    // Загружаем HTML из файла
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $("#extensions_settings").append(settingsHtml);

    // Загружаем настройки при старте
    await loadSettings(callbacks);
    await initializeSlots(callbacks);
    await assignCharactersToSlots(callbacks);
    
    // Инициализируем previousChatId как 'unknown' при старте
    // previousChatId больше никогда не будет присвоен 'unknown'
    previousChatId = 'unknown';
    
    updateNextSaveIndicator(callbacks);
    
    // Обновляем список слотов при запуске генерации
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, async (data) => {
        updateSlotsList(callbacks);
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
    window['KVCacheManagerInterceptor'] = async (chat, contextSize, abort, type) => {
        await KVCacheManagerInterceptor(chat, contextSize, abort, type, {
            ...callbacks,
            MIN_USAGE_FOR_SAVE
        });
    };
    
    // Подписка на событие получения сообщения для автосохранения
    eventSource.on(event_types.MESSAGE_RECEIVED, async (data) => {
        // Получаем нормализованное имя персонажа из данных события
        const characterName = getNormalizedCharacterNameFromData(data);
        await incrementMessageCounter(characterName, callbacks);
    });
    
    // Подписка на событие переключения чата для автозагрузки
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        const currentChatId = getNormalizedChatId();
        const previousChatIdNormalized = previousChatId;
        
        // Проверяем, изменилось ли имя чата (и не меняется ли оно на "unknown")
        // previousChatId может быть 'unknown' только при первой смене чата
        const chatIdChanged = currentChatId !== 'unknown' &&
                              previousChatId !== currentChatId;
        
        const extensionSettings = getExtensionSettings();
        
        // Обновляем previousChatId для следующего события (никогда не присваиваем 'unknown')
        if (currentChatId !== 'unknown') {
            previousChatId = currentChatId;
        }
        
        // Если имя чата не изменилось или меняется с/на unknown - не запускаем очистку
        if (!chatIdChanged) {
            console.debug(`[KV Cache Manager] Имя чата не изменилось (${previousChatIdNormalized} -> ${currentChatId}) или меняется с/на unknown, пропускаем очистку`);
            return;
        }
        
        // Проверяем настройку очистки при смене чата
        if (!extensionSettings.clearOnChatChange) {
            console.debug(`[KV Cache Manager] Очистка при смене чата отключена в настройках`);
            return;
        }
        
        console.debug(`[KV Cache Manager] Смена чата: ${previousChatIdNormalized} -> ${currentChatId}`);
        
        // ВАЖНО: Сначала сохраняем кеш для всех персонажей, которые были в слотах
        await saveAllSlotsCache(callbacks);
        
        // Затем очищаем все слоты на сервере
        await clearAllSlotsCache(callbacks);
        
        // Распределяем персонажей по слотам (групповой режим всегда включен)
        await assignCharactersToSlots(callbacks);
    });
    
    // При переключении чата счетчик не сбрасывается - каждый чат имеет свой независимый счетчик
    // Счетчик автоматически создается при первом сообщении в новом чате

    // Настраиваем обработчики событий для настроек
    const settingsHandlers = createSettingsHandlers(callbacks);
    $("#kv-cache-enabled").on("input", settingsHandlers.onEnabledChange);
    $("#kv-cache-save-interval").on("input", settingsHandlers.onSaveIntervalChange);
    $("#kv-cache-max-files").on("input", settingsHandlers.onMaxFilesChange);
    $("#kv-cache-show-notifications").on("input", settingsHandlers.onShowNotificationsChange);
    $("#kv-cache-clear-on-chat-change").on("input", settingsHandlers.onClearOnChatChangeChange);
    
    // Обработчики для кнопок
    $("#kv-cache-save-button").on("click", () => onSaveButtonClick(callbacks));
    $("#kv-cache-load-button").on("click", () => onLoadButtonClick(callbacks));
    $("#kv-cache-save-now-button").on("click", () => onSaveNowButtonClick(callbacks));
    
    // Кнопка предзагрузки пока не реализована - отключаем
    $("#kv-cache-preload-characters-button")
        .prop("disabled", true)
        .attr("title", "Функция пока не реализована");
    
    $("#kv-cache-release-all-slots-button").on("click", () => onReleaseAllSlotsButtonClick(callbacks));
    
    // Обработчик для кнопок сохранения слотов (делегирование для динамических элементов)
    $(document).on("click", ".kv-cache-save-slot-button", (event) => onSaveSlotButtonClick(event, callbacks));
    
    // Обработчики для модалки загрузки (используем делегирование для динамических элементов)
    $(document).on("click", "#kv-cache-load-modal-close", () => closeLoadModal());
    $(document).on("click", "#kv-cache-load-cancel-button", () => closeLoadModal());
    $(document).on("click", "#kv-cache-load-confirm-button", () => loadSelectedCache(callbacks));
    
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
