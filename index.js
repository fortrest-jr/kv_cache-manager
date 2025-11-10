// KV Cache Manager для SillyTavern
// Расширение для управления KV-кешем llama.cpp

// Импортируем необходимые функции
import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, getCurrentChatId, characters } from "../../../../script.js";
import { textgen_types, textgenerationwebui_settings } from '../../../textgen-settings.js';
import { getGroupMembers } from '../../../group-chats.js';

// Имя расширения должно совпадать с именем папки
const extensionName = "kv_cache-manager";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const defaultSettings = {
    enabled: true,
    saveInterval: 5,
    autoLoadOnChatSwitch: true,
    autoLoadAskConfirmation: false,
    maxFiles: 10,
    showNotifications: true,
    checkSlotUsage: true,
    clearSlotsOnChatSwitch: true,
    groupChatMode: false
};

const extensionSettings = extension_settings[extensionName] ||= {};

// Константы
const MIN_USAGE_FOR_SAVE = 2; // Минимальное количество использований слота для сохранения кеша перед вытеснением
const MIN_FILE_SIZE_MB = 1; // Минимальный размер файла кеша в МБ (файлы меньше этого размера считаются невалидными)
const SAVE_TIMEOUT_MS = 300000; // Таймаут для сохранения кеша (5 минут)
const LOAD_TIMEOUT_MS = 300000; // Таймаут для загрузки кеша (5 минут)
const CLEAR_TIMEOUT_MS = 30000; // Таймаут для очистки кеша (30 секунд)
const FILE_CHECK_DELAY_MS = 500; // Задержка перед проверкой размера файла после сохранения (мс)

// Счетчик сообщений для каждого персонажа в каждом чата (для автосохранения)
// Структура: { [chatId]: { [characterName]: count } }
const messageCounters = {};

// ID последнего чата, для которого была выполнена автозагрузка
// При входе в этот чат не предлагаем загружать снова
let lastLoadedChatId = null;

// Текущий слот для генерации (используется в режиме групповых чатов)
let currentSlot = null;

// Текущее состояние слотов (не настройки, а состояние)
// Массив объектов, описывающих состояние каждого слота
// currentSlots[i] = { characterName: string | undefined, usage: number }
let currentSlots = [];

// Обновление индикатора следующего сохранения
// Показывает минимальное оставшееся количество сообщений среди всех персонажей
function updateNextSaveIndicator() {
    const indicator = $("#kv-cache-next-save");
    const headerTitle = $(".kv-cache-manager-settings .inline-drawer-toggle.inline-drawer-header b");
    
    if (indicator.length === 0 && headerTitle.length === 0) {
        return;
    }
    
    if (!extensionSettings.enabled) {
        if (indicator.length > 0) {
            indicator.text("Автосохранение отключено");
        }
        if (headerTitle.length > 0) {
            headerTitle.text("KV Cache Manager");
        }
        return;
    }
    
    const chatId = getNormalizedChatId();
    const chatCounters = messageCounters[chatId] || {};
    const interval = extensionSettings.saveInterval;
    
    // Находим минимальное оставшееся количество сообщений среди всех персонажей
    let minRemaining = Infinity;
    let hasCounters = false;
    
    for (const characterName in chatCounters) {
        hasCounters = true;
        const count = chatCounters[characterName] || 0;
        const remaining = Math.max(0, interval - count);
        if (remaining < minRemaining) {
            minRemaining = remaining;
        }
    }
    
    // Если нет счетчиков, показываем полный интервал
    if (!hasCounters) {
        minRemaining = interval;
    }
    
    // Обновляем индикатор в настройках
    if (indicator.length > 0) {
        if (minRemaining === 0) {
            indicator.text("Следующее сохранение при следующем сообщении");
        } else {
            const messageWord = minRemaining === 1 ? 'сообщение' : minRemaining < 5 ? 'сообщения' : 'сообщений';
            indicator.text(`Следующее сохранение через: ${minRemaining} ${messageWord}`);
        }
    }
    
    // Обновляем заголовок расширения с числом в квадратных скобках
    if (headerTitle.length > 0) {
        headerTitle.text(`[${minRemaining}] KV Cache Manager`);
    }
}

// Сохранение кеша для персонажа (автосохранение)
// @param {string} characterName - имя персонажа
// @param {number} slotIndex - индекс слота
// @returns {Promise<boolean>} - true если кеш был сохранен, false если ошибка
async function saveCharacterCache(characterName, slotIndex) {
    if (!characterName || typeof characterName !== 'string') {
        return false;
    }
    
    if (slotIndex === null || slotIndex === undefined) {
        return false;
    }
    
    try {
        const chatId = getNormalizedChatId();
        const timestamp = formatTimestamp();
        const filename = generateSaveFilename(chatId, timestamp, characterName);
        
        console.debug(`[KV Cache Manager] Сохранение кеша для персонажа ${characterName} в слот ${slotIndex}`);
        
        const success = await saveSlotCache(slotIndex, filename, characterName);
        
        if (success) {
            // Выполняем ротацию файлов для этого персонажа
            await rotateCharacterFiles(characterName);
            console.debug(`[KV Cache Manager] Кеш успешно сохранен для персонажа ${characterName}`);
            return true;
        } else {
            console.error(`[KV Cache Manager] Не удалось сохранить кеш для персонажа ${characterName}`);
            return false;
        }
    } catch (e) {
        console.error(`[KV Cache Manager] Ошибка при сохранении кеша для персонажа ${characterName}:`, e);
        return false;
    }
}

// Увеличение счетчика сообщений для конкретного персонажа
async function incrementMessageCounter(characterName) {
    if (!extensionSettings.enabled) {
        return;
    }
    
    if (!characterName) {
        // Если имя персонажа не указано, пропускаем
        return;
    }
    
    const chatId = getNormalizedChatId();
    if (!messageCounters[chatId]) {
        messageCounters[chatId] = {};
    }
    
    if (!messageCounters[chatId][characterName]) {
        messageCounters[chatId][characterName] = 0;
    }
    
    messageCounters[chatId][characterName]++;
    
    updateNextSaveIndicator();
    
    // Проверяем, нужно ли сохранить для этого персонажа
    const interval = extensionSettings.saveInterval;
    if (messageCounters[chatId][characterName] >= interval) {
        // Находим слот, в котором находится персонаж
        let slotIndex = null;
        
        if (extensionSettings.groupChatMode && currentSlots) {
            // Сравниваем нормализованные имена, так как в слотах хранятся нормализованные имена
            const normalizedName = normalizeCharacterName(characterName);
            slotIndex = currentSlots.findIndex(slot => {
                const slotName = slot?.characterName;
                return slotName && normalizeCharacterName(slotName) === normalizedName;
            });
            if (slotIndex === -1) {
                slotIndex = null;
            }
        } else {
            // В обычном режиме используем первый активный слот
            // Это временное решение, пока не реализовано распределение слотов
            try {
                const activeSlots = await getActiveSlots();
                if (activeSlots.length > 0) {
                    slotIndex = activeSlots[0];
                } else {
                    console.warn(`[KV Cache Manager] Не удалось найти слот для сохранения персонажа ${characterName}`);
                    return;
                }
            } catch (e) {
                console.error(`[KV Cache Manager] Ошибка при получении активных слотов для персонажа ${characterName}:`, e);
                return;
            }
        }
        
        if (slotIndex !== null) {
            // Запускаем автосохранение для этого персонажа
            try {
                const success = await saveCharacterCache(characterName, slotIndex);
                if (success) {
                    // Сбрасываем счетчик только после успешного сохранения
                    messageCounters[chatId][characterName] = 0;
                    updateNextSaveIndicator();
                }
            } catch (e) {
                // При ошибке не сбрасываем счетчик, чтобы попробовать сохранить снова
                console.error(`[KV Cache Manager] Ошибка при автосохранении кеша для персонажа ${characterName}:`, e);
            }
        } else {
            console.warn(`[KV Cache Manager] Не удалось найти слот для сохранения персонажа ${characterName}`);
        }
    }
}

// Загрузка настроек
async function loadSettings() {
    // Убеждаемся, что все поля из defaultSettings инициализированы
    for (const key in defaultSettings) {
        if (!(key in extensionSettings)) {
            extensionSettings[key] = defaultSettings[key];
        }
    }
    $("#kv-cache-enabled").prop("checked", extensionSettings.enabled).trigger("input");
    $("#kv-cache-save-interval").val(extensionSettings.saveInterval).trigger("input");
    $("#kv-cache-max-files").val(extensionSettings.maxFiles).trigger("input");
    $("#kv-cache-auto-load").prop("checked", extensionSettings.autoLoadOnChatSwitch).trigger("input");
    $("#kv-cache-auto-load-ask").prop("checked", extensionSettings.autoLoadAskConfirmation).trigger("input");
    $("#kv-cache-show-notifications").prop("checked", extensionSettings.showNotifications).trigger("input");
    $("#kv-cache-validate").prop("checked", extensionSettings.checkSlotUsage).trigger("input");
    $("#kv-cache-clear-slots").prop("checked", extensionSettings.clearSlotsOnChatSwitch).trigger("input");
    $("#kv-cache-group-chat-mode").prop("checked", extensionSettings.groupChatMode).trigger("input");
    
    // Обновляем индикатор следующего сохранения
    updateNextSaveIndicator();
    
    // Обновляем информацию о слотах
    updateSlotsAvailability();
}

// Показ toast-уведомления
function showToast(type, message, title = 'KV Cache Manager') {
    if (typeof toastr === 'undefined') {
        console.debug(`[KV Cache Manager] ${title}: ${message}`);
        return;
    }

    if (!extensionSettings.showNotifications) {
        return;
    }

    switch (type) {
        case 'success':
            toastr.success(message, title);
            break;
        case 'error':
            toastr.error(message, title);
            break;
        case 'warning':
            toastr.warning(message, title);
            break;
        case 'info':
        default:
            toastr.info(message, title);
            break;
    }
}

// Обработчики для чекбоксов и полей ввода
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

function onAutoLoadChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extensionSettings.autoLoadOnChatSwitch = value;
    saveSettingsDebounced();
}

function onAutoLoadAskConfirmationChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extensionSettings.autoLoadAskConfirmation = value;
    saveSettingsDebounced();
}

function onShowNotificationsChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extensionSettings.showNotifications = value;
    saveSettingsDebounced();
    showToast('success', `Уведомления ${value ? 'включены' : 'отключены'}`);
}

function onValidateChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extensionSettings.checkSlotUsage = value;
    saveSettingsDebounced();
}

function onClearSlotsChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extensionSettings.clearSlotsOnChatSwitch = value;
    saveSettingsDebounced();
}

function onGroupChatModeChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extensionSettings.groupChatMode = value;
    saveSettingsDebounced();
    if (value) {
        // Инициализируем слоты и распределяем персонажей при включении режима
        initializeSlots().then(() => {
            assignCharactersToSlots();
        });
    }
}

// Получение URL llama.cpp сервера
function getLlamaUrl() {
    const provided_url = textgenerationwebui_settings.server_urls[textgen_types.LLAMACPP]
    console.debug('LlamaCpp server URL: ' + provided_url);
    return provided_url;
}


// Получение количества слотов из ответа /slots
function getSlotsCountFromData(slotsData) {
    if (Array.isArray(slotsData)) {
        return slotsData.length;
    } else if (typeof slotsData === 'object' && slotsData !== null) {
        return Object.keys(slotsData).length;
    }
    return 0;
}

// Формирование timestamp для имени файла (YYYYMMDDHHMMSS)
function formatTimestamp(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hour}${minute}${second}`;
}

// Общая функция нормализации строк для использования в именах файлов и сравнениях
// Заменяет все недопустимые символы (включая пробелы) на подчеркивания
function normalizeString(str, defaultValue = '') {
    if (!str && str !== 0) {
        return defaultValue;
    }
    return String(str).replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Нормализация chatId для использования в именах файлов и сравнениях
function normalizeChatId(chatId) {
    return normalizeString(chatId, 'unknown');
}

// Получение нормализованного chatId текущего чата
function getNormalizedChatId() {
    return normalizeChatId(getCurrentChatId());
}

// Нормализация имени персонажа для использования в именах файлов и сравнениях
function normalizeCharacterName(characterName) {
    return normalizeString(characterName, '');
}

// Получение списка персонажей текущего чата
// Использует правильный подход SillyTavern для определения персонажей
function getChatCharacters() {
    try {
        const context = getContext();
        
        if (!context) {
            console.warn('[KV Cache Manager] Не удалось получить контекст чата');
            return [];
        }
        
        // Проверяем, является ли чат групповым
        if (context.groupId === null || context.groupId === undefined) {
            // Обычный (одиночный) чат
            // Возвращаем только имя персонажа (name2), пользователя (name1) не включаем
            const characterName = context.name2;
            if (characterName) {
                console.debug(`[KV Cache Manager] Обычный чат, найден персонаж: ${characterName}`);
                return [characterName];
            }
            return [];
        } else {
            // Групповой чат
            // Используем getGroupMembers() для получения массива объектов персонажей
            const groupMembers = getGroupMembers(context.groupId);
            
            if (!groupMembers || groupMembers.length === 0) {
                console.warn('[KV Cache Manager] Не найдено участников группового чата');
                return [];
            }
            
            // Извлекаем имена персонажей из массива объектов
            const characterNames = groupMembers
                .map(member => member?.name)
                .filter(name => name && typeof name === 'string');
            
            console.debug(`[KV Cache Manager] Групповой чат, найдено ${characterNames.length} персонажей:`, characterNames);
            return characterNames;
        }
    } catch (e) {
        console.error('[KV Cache Manager] Ошибка при получении персонажей чата:', e);
        return [];
    }
}

// Генерация имени файла в едином формате
// Форматы:
// - Автосохранение: {chatId}_{timestamp}_character_{characterName}.bin
// - С тегом: {chatId}_{timestamp}_tag_{tag}_character_{characterName}.bin
// @param {string} chatId - ID чата
// @param {string} timestamp - временная метка
// @param {string} characterName - имя персонажа (обязательно)
// @param {string} tag - тег для ручного сохранения (опционально)
function generateSaveFilename(chatId, timestamp, characterName, tag = null) {
    const safeChatId = normalizeChatId(chatId);
    const safeCharacterName = normalizeCharacterName(characterName);
    
    // Ручное сохранение с тегом
    if (tag) {
        const safeTag = normalizeString(tag);
        return `${safeChatId}_${timestamp}_tag_${safeTag}_character_${safeCharacterName}.bin`;
    }
    
    // Автосохранение (без тега)
    return `${safeChatId}_${timestamp}_character_${safeCharacterName}.bin`;
}

// Парсинг имени файла для извлечения данных
// Поддерживает форматы:
// - Автосохранение: {chatId}_{timestamp}_character_{characterName}.bin
// - С тегом: {chatId}_{timestamp}_tag_{tag}_character_{characterName}.bin
// Также поддерживает старый формат для обратной совместимости:
// - {chatId}_{timestamp}_tag_{tag}_slot{slotId}.bin
// - {chatId}_{timestamp}_slot{slotId}.bin
// Возвращает { chatId, timestamp, tag, slotId, characterName } или null при ошибке
function parseSaveFilename(filename) {
    // Убираем расширение .bin
    const nameWithoutExt = filename.replace(/\.bin$/, '');
    
    let tag = null;
    let characterName = null;
    let beforeSuffix = nameWithoutExt;
    
    // Проверяем новый формат: _character_{characterName} (всегда в конце)
    const characterMatch = nameWithoutExt.match(/_character_(.+)$/);
    if (!characterMatch) {
        return null;
    }
    characterName = characterMatch[1];
    beforeSuffix = nameWithoutExt.slice(0, -characterMatch[0].length);
    
    // Проверяем наличие _tag_{tag} перед _character
    const tagMatch = beforeSuffix.match(/_tag_(.+)$/);
    if (tagMatch) {
        tag = tagMatch[1];
        beforeSuffix = beforeSuffix.slice(0, -tagMatch[0].length);
    }
    
    // Ищем timestamp (14 цифр) с конца
    const timestampMatch = beforeSuffix.match(/_(\d{14})$/);
    if (!timestampMatch) {
        return null;
    }
    
    const timestamp = timestampMatch[1];
    const chatId = beforeSuffix.slice(0, -timestampMatch[0].length);
    
    return {
        chatId: chatId,
        timestamp: timestamp,
        tag: tag,
        characterName: characterName
    };
}

// Получение информации о всех слотах через /slots
async function getAllSlotsInfo() {
    const llamaUrl = getLlamaUrl();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут
        
        const response = await fetch(`${llamaUrl}slots`, {
            method: 'GET',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const slotsData = await response.json();
            return slotsData;
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.debug('[KV Cache Manager] Ошибка получения информации о слотах:', e);
            const errorMessage = e.message || String(e);
            showToast('error', `Ошибка получения информации о слотах: ${errorMessage}`);
        }
    }
    
    return null;
}

// Проверка валидности слота (есть ли в нем данные)
function slotUsed(slotInfo) {
    if (!slotInfo || typeof slotInfo !== 'object') {
        return false;
    }
    
    // Слот использован, если есть параметр id_task
    return 'id_task' in slotInfo && slotInfo.id_task != null;
}

// Получение всех активных слотов с проверкой валидности
async function getActiveSlots() {
    const slotsData = await getAllSlotsInfo();
    
    if (!slotsData) {
        console.debug('[KV Cache Manager] Не удалось получить информацию о слотах');
        return [];
    }
    
    // Обрабатываем разные форматы ответа
    let slotsArray = [];
    
    if (Array.isArray(slotsData)) {
        // Если это массив слотов
        slotsArray = slotsData;
    } else if (typeof slotsData === 'object') {
        // Если это объект, преобразуем в массив
        slotsArray = Object.values(slotsData);
    }
    
    // Если проверка отключена, возвращаем все слоты
    if (!extensionSettings.checkSlotUsage) {
        return Array.from({ length: slotsArray.length }, (_, i) => i);
    }
    
    // Фильтруем валидные слоты
    const validSlots = [];
    slotsArray.forEach((slotInfo, index) => {
        if (slotUsed(slotInfo)) {
            validSlots.push(index);
        }
    });
    
    return validSlots;
}

// Инициализация слотов для режима групповых чатов
async function initializeSlots(totalSlots = null) {
    if (!extensionSettings.groupChatMode) {
        return;
    }
    
    // Если количество слотов не указано, получаем его с сервера
    if (totalSlots === null) {
        const slotsData = await getAllSlotsInfo();
        if (slotsData) {
            totalSlots = getSlotsCountFromData(slotsData);
        } else {
            console.warn('[KV Cache Manager] Не удалось получить количество слотов, используем значение по умолчанию');
            totalSlots = 2;
        }
    }
    
    // Инициализируем массив объектов состояния слотов
    currentSlots = [];
    
    // Создаем объекты для каждого слота
    for (let i = 0; i < totalSlots; i++) {
        currentSlots[i] = {
            characterName: undefined,
            usage: 0
        };
    }
    
    console.debug(`[KV Cache Manager] Инициализировано ${totalSlots} слотов для режима групповых чатов`);
    
    // Обновляем UI
    updateSlotsAvailability();
}

// Распределение персонажей по слотам из текущего чата
// Очищает старых персонажей из других чатов
async function assignCharactersToSlots() {
    if (!extensionSettings.groupChatMode) {
        return;
    }
    
    // Получаем персонажей текущего чата
    const chatCharacters = await getChatCharacters();
    
    // Инициализируем слоты, если еще не инициализированы
    if (!currentSlots || currentSlots.length === 0) {
        await initializeSlots();
    }
    
    const totalSlots = currentSlots.length;
    
    // Сохраняем кеш для всех персонажей, которые были в слотах перед очисткой
    // Важно: дожидаемся завершения сохранения перед очисткой слотов, чтобы избежать потери данных
    for (let i = 0; i < totalSlots; i++) {
        const slot = currentSlots[i];
        const currentCharacter = slot?.characterName;
        if (currentCharacter && typeof currentCharacter === 'string') {
            const usageCount = slot.usage || 0;
            
            // Сохраняем кеш перед вытеснением только если персонаж использовал слот минимум 2 раза
            if (usageCount >= MIN_USAGE_FOR_SAVE) {
                await saveCharacterCache(currentCharacter, i);
            } else {
                console.debug(`[KV Cache Manager] Пропускаем сохранение кеша для ${currentCharacter} (использование: ${usageCount} < ${MIN_USAGE_FOR_SAVE})`);
            }
        }
    }
    
    // Полностью очищаем все слоты только после завершения всех сохранений
    for (let i = 0; i < totalSlots; i++) {
        currentSlots[i] = {
            characterName: undefined,
            usage: 0
        };
    }
    
    if (chatCharacters.length === 0) {
        console.debug('[KV Cache Manager] Не найдено персонажей в текущем чате для распределения по слотам');
        updateSlotsAvailability();
        return;
    }
    
    console.debug(`[KV Cache Manager] Распределение ${chatCharacters.length} персонажей по ${totalSlots} слотам`);
    
    // Распределяем персонажей по слотам: идем по индексу, пока не закончатся либо слоты, либо персонажи
    // Важно: храним нормализованные имена для единообразного сравнения
    for (let i = 0; i < totalSlots && i < chatCharacters.length; i++) {
        currentSlots[i] = {
            characterName: normalizeCharacterName(chatCharacters[i]),
            usage: 0 // Начальный счетчик использования
        };
    }
    
    console.debug(`[KV Cache Manager] Персонажи распределены по слотам:`, currentSlots);
    
    // Загружаем кеш для всех персонажей, которые были распределены в слоты
    await loadCacheForSlottedCharacters();
    
    // Обновляем UI
    updateSlotsAvailability();
}

// Загрузка кеша для персонажей, которые распределены в слоты
async function loadCacheForSlottedCharacters() {
    if (!extensionSettings.groupChatMode || !currentSlots) {
        return;
    }
    
    // Получаем список персонажей из слотов (только тех, кто реально в слотах)
    const slottedCharacters = currentSlots
        .map((slot, index) => ({ characterName: slot?.characterName, slotIndex: index }))
        .filter(item => item.characterName && typeof item.characterName === 'string');
    
    if (slottedCharacters.length === 0) {
        console.debug('[KV Cache Manager] Нет персонажей в слотах для загрузки кеша');
        return;
    }
    
    // Загружаем кеш для каждого персонажа, который в слотах
    for (const { characterName, slotIndex } of slottedCharacters) {
        
        try {
            const cacheInfo = await getLastCacheForCharacter(characterName, true); // Только из текущего чата
            
            if (cacheInfo) {
                console.debug(`[KV Cache Manager] Загружаю кеш для персонажа ${characterName} в слот ${slotIndex}...`);
                const loaded = await loadSlotCache(slotIndex, cacheInfo.filename);
                
                if (loaded) {
                    // Форматируем дату-время из timestamp для тоста
                    const parsed = parseSaveFilename(cacheInfo.filename);
                    if (parsed && parsed.timestamp) {
                        const dateTimeStr = formatTimestampToDate(parsed.timestamp);
                        
                        // Выводим тост для каждого успешно загруженного персонажа
                        if (extensionSettings.showNotifications) {
                            showToast('success', `Загружен кеш для ${characterName} (${dateTimeStr})`, 'Загрузка кеша');
                        }
                    }
                    console.debug(`[KV Cache Manager] Кеш персонажа ${characterName} успешно загружен в слот ${slotIndex}`);
                } else {
                    console.warn(`[KV Cache Manager] Не удалось загрузить кеш для персонажа ${characterName}`);
                }
            } else {
                console.debug(`[KV Cache Manager] Кеш для персонажа ${characterName} не найден`);
            }
        } catch (e) {
            console.error(`[KV Cache Manager] Ошибка при загрузке кеша для персонажа ${characterName}:`, e);
        }
    }
}

// Поиск индекса слота для персонажа (если персонаж уже в слоте)
// @param {string} characterName - Имя персонажа
// @returns {number|null} - Индекс слота или null, если персонаж не найден в слотах
function findCharacterSlotIndex(characterName) {
    if (!currentSlots) {
        return null;
    }
    
    const normalizedName = normalizeCharacterName(characterName);
    const index = currentSlots.findIndex(slot => {
        const slotName = slot?.characterName;
        return slotName && normalizeCharacterName(slotName) === normalizedName;
    });
    
    return index !== -1 ? index : null;
}

// Получение слота для персонажа
// 1. Если персонаж уже в слоте - возвращаем этот слот
// 2. Если нет - ищем пустой слот, возвращаем его
// 3. Если пустых нет - освобождаем слот с наименьшим использованием и возвращаем его
// Функция занимается только управлением слотами, не управляет счетчиком использования
// @param {string} characterName - Имя персонажа (используется как идентификатор)
async function acquireSlot(characterName) {
    if (!extensionSettings.groupChatMode) {
        return null;
    }
    
    // Нормализуем имя персонажа для единообразного сравнения
    const normalizedName = normalizeCharacterName(characterName);
    
    // 1. Проверяем, есть ли персонаж уже в слоте - если да, возвращаем этот слот
    const existingIndex = findCharacterSlotIndex(characterName);
    if (existingIndex !== null) {
        // Персонаж уже в слоте - возвращаем существующий слот
        console.debug(`[KV Cache Manager] Персонаж ${characterName} уже в слоте ${existingIndex}, счетчик: ${currentSlots[existingIndex].usage || 0}`);
        updateSlotsAvailability();
        return existingIndex;
    }
    
    // 2. Персонаж не в слоте - ищем пустой слот
    const freeSlotIndex = currentSlots.findIndex(slot => !slot?.characterName);
    if (freeSlotIndex !== -1) {
        // Найден пустой слот - устанавливаем персонажа туда (храним нормализованное имя)
        // Счетчик использования всегда начинается с 0, управление счетчиком вне этой функции
        currentSlots[freeSlotIndex] = {
            characterName: normalizedName,
            usage: 0
        };
        console.debug(`[KV Cache Manager] Персонаж ${characterName} установлен в пустой слот ${freeSlotIndex}, счетчик: ${currentSlots[freeSlotIndex].usage}`);
        updateSlotsAvailability();
        return freeSlotIndex;
    }
    
    // 3. Пустых слотов нет - находим слот с наименьшим использованием и освобождаем его
    let minUsage = Infinity;
    let minUsageIndex = -1;
    
    for (let i = 0; i < currentSlots.length; i++) {
        const currentUsage = currentSlots[i]?.usage;
        if (currentUsage < minUsage) {
            minUsage = currentUsage;
            minUsageIndex = i;
        }
    }
    
    if (minUsageIndex === -1) {
        console.warn('[KV Cache Manager] Не удалось найти слот для персонажа');
        return null;
    }
    
    // Освобождаем слот с наименьшим использованием
    const evictedSlot = currentSlots[minUsageIndex];
    const evictedCharacter = evictedSlot?.characterName;
    
    if (evictedCharacter && typeof evictedCharacter === 'string') {
        const usageCount = evictedSlot.usage;
        
        // Сохраняем кеш перед вытеснением только если персонаж использовал слот минимум 2 раза
        if (usageCount >= MIN_USAGE_FOR_SAVE) {
            await saveCharacterCache(evictedCharacter, minUsageIndex);
            // Уведомление о сохранении показывается внутри saveSlotCache
        } else {
            console.debug(`[KV Cache Manager] Пропускаем сохранение кеша для ${evictedCharacter} (использование: ${usageCount} < ${MIN_USAGE_FOR_SAVE})`);
        }
    }
    
    // Устанавливаем персонажа в освобожденный слот
    // Храним нормализованное имя для единообразного сравнения
    // Счетчик использования всегда начинается с 0, управление счетчиком вне этой функции
    currentSlots[minUsageIndex] = {
        characterName: normalizedName,
        usage: 0
    };
    
    console.debug(`[KV Cache Manager] Персонаж ${characterName} установлен в слот ${minUsageIndex}${evictedCharacter ? ` (вытеснен ${evictedCharacter}, использование: ${minUsage})` : ' (свободный слот)'}, счетчик: ${currentSlots[minUsageIndex].usage}`);
    
    updateSlotsAvailability();
    
    return minUsageIndex;
}

// Освобождение слота
function releaseSlot(slotIndex) {
    if (!extensionSettings.groupChatMode) {
        return;
    }
    
    const slot = currentSlots[slotIndex];
    const characterName = slot?.characterName;
    currentSlots[slotIndex] = {
        characterName: undefined,
        usage: 0
    };
    
    console.debug(`[KV Cache Manager] Освобожден слот ${slotIndex} (персонаж: ${characterName})`);
    
    updateSlotsAvailability();
}

// Освобождение всех слотов
function releaseAllSlots() {
    if (!extensionSettings.groupChatMode) {
        return;
    }
    
    const totalSlots = currentSlots.length || 0;
    for (let i = 0; i < totalSlots; i++) {
        currentSlots[i] = {
            characterName: undefined,
            usage: 0
        };
    }
    
    console.debug(`[KV Cache Manager] Освобождены все слоты`);
    
    updateSlotsAvailability();
}

// Обновление UI с информацией о слотах
// Обновление списка слотов в UI (объединенный виджет)
async function updateSlotsList() {
    const slotsListElement = $("#kv-cache-slots-list");
    if (slotsListElement.length === 0) {
        return;
    }
    
    try {
        // Получаем информацию о слотах для определения общего количества
        const slotsData = await getAllSlotsInfo();
        const totalSlots = slotsData ? getSlotsCountFromData(slotsData) : 0;
        
        if (extensionSettings.groupChatMode && currentSlots && currentSlots.length > 0) {
            // Режим групповых чатов: показываем детальную информацию о слотах
            const slots = currentSlots;
            
            let html = '<ul style="margin: 5px 0; padding-left: 20px;">';
            let usedCount = 0;
            
            for (let i = 0; i < slots.length; i++) {
                const slot = slots[i];
                const characterName = slot?.characterName;
                const isUsed = characterName && typeof characterName === 'string';
                
                if (isUsed) {
                    usedCount++;
                }
                
                html += `<li style="margin: 3px 0;">`;
                html += `Слот <strong>${i}</strong>: `;
                
                if (isUsed) {
                    html += `<span style="color: var(--SmartThemeBodyColor, inherit);">${characterName}</span> `;
                    html += `<span style="font-size: 0.85em; color: var(--SmartThemeBodyColor, #888);">[использовано: ${slot?.usage}]</span>`;
                } else {
                    html += `<span style="color: #888; font-style: italic;">(свободен)</span>`;
                }
                
                html += `</li>`;
            }
            
            html += '</ul>';
            html += `<p style="margin-top: 5px; font-size: 0.9em; color: var(--SmartThemeBodyColor, inherit);">Занято: ${usedCount} / ${totalSlots} (свободно: ${totalSlots - usedCount})</p>`;
            
            slotsListElement.html(html);
        } else {
            // Обычный режим: показываем только активные слоты
            const validSlots = await getActiveSlots();
            
            if (validSlots.length === 0) {
                slotsListElement.html('<p style="color: var(--SmartThemeBodyColor, inherit);">Нет активных слотов с валидным кешем</p>');
                return;
            }
            
            let html = '<ul style="margin: 5px 0; padding-left: 20px;">';
            for (const slotId of validSlots) {
                html += `<li style="margin: 3px 0;">Слот <strong>${slotId}</strong></li>`;
            }
            html += '</ul>';
            html += `<p style="margin-top: 5px; font-size: 0.9em; color: var(--SmartThemeBodyColor, inherit);">Всего: ${validSlots.length} слот(ов) из ${totalSlots}</p>`;
            
            slotsListElement.html(html);
        }
    } catch (e) {
        console.error('[KV Cache Manager] Ошибка при обновлении списка слотов:', e);
        const errorMessage = e.message || 'Неизвестная ошибка';
        slotsListElement.html(`<p style="color: var(--SmartThemeBodyColor, inherit);">Ошибка загрузки слотов: ${errorMessage}</p>`);
    }
}

// Обновление статуса слотов (для обратной совместимости, теперь вызывает updateSlotsList)
function updateSlotsAvailability() {
    // Обновляем объединенный список слотов
    updateSlotsList();
}

// Сохранение кеша для слота
// @param {number} slotId - Индекс слота
// @param {string} filename - Имя файла для сохранения
// @param {string} characterName - Имя персонажа (обязательно)
async function saveSlotCache(slotId, filename, characterName) {
    const llamaUrl = getLlamaUrl();
    const url = `${llamaUrl}slots/${slotId}?action=save`;
    const requestBody = { filename: filename };
    
    console.debug(`[KV Cache Manager] Сохранение кеша: URL=${url}, filename=${filename}`);
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        console.debug(`[KV Cache Manager] Ответ сервера: status=${response.status}, ok=${response.ok}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[KV Cache Manager] Ошибка сохранения слота ${slotId}: ${response.status} ${errorText}`);
            
            showToast('error', `Не удалось сохранить кеш для ${characterName}`);
            
            return false;
        }
        
        console.debug(`[KV Cache Manager] Кеш успешно сохранен для слота ${slotId}`);
        
        // Проверяем размер сохраненного файла
        try {
            // Ждем немного, чтобы файл точно был сохранен на сервере
            await new Promise(resolve => setTimeout(resolve, FILE_CHECK_DELAY_MS));
            
            const filesList = await getFilesList();
            const savedFile = filesList.find(file => file.name === filename);
            
            if (savedFile) {
                const fileSizeMB = savedFile.size / (1024 * 1024); // Размер в мегабайтах
                
                if (fileSizeMB < MIN_FILE_SIZE_MB) {
                    // Файл меньше минимального размера - считаем невалидным и удаляем
                    console.warn(`[KV Cache Manager] Файл ${filename} слишком мал (${fileSizeMB.toFixed(2)} МБ), удаляем как невалидный`);
                    await deleteFile(filename);
                    showToast('error', `Файл кеша для ${characterName} слишком мал (${fileSizeMB.toFixed(2)} МБ) и был удален`);
                    return false;
                }
            }
        } catch (e) {
            console.warn(`[KV Cache Manager] Не удалось проверить размер файла ${filename}:`, e);
            // Продолжаем, даже если не удалось проверить размер
        }
        
        showToast('success', `Кеш для ${characterName} успешно сохранен`);
        
        return true;
    } catch (e) {
        if (e.name === 'AbortError') {
            console.error(`[KV Cache Manager] Таймаут при сохранении кеша слота ${slotId}`);
            showToast('error', `Таймаут при сохранении кеша для ${characterName}`);
        } else {
            console.error(`[KV Cache Manager] Ошибка сохранения слота ${slotId}:`, e);
            showToast('error', `Ошибка при сохранении кеша для ${characterName}: ${e.message}`);
        }
        return false;
    }
}

// Загрузка кеша для слота
async function loadSlotCache(slotId, filename) {
    const llamaUrl = getLlamaUrl();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
        
        console.debug(`[KV Cache Manager] Загрузка кеша: слот ${slotId}, файл ${filename}`);
        
        const response = await fetch(`${llamaUrl}slots/${slotId}?action=restore`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filename: filename }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[KV Cache Manager] Ошибка загрузки кеша слота ${slotId}: ${response.status} ${errorText}`);
            return false;
        }
        
        // При любой загрузке кеша сбрасываем счетчик использования в 0
        if (extensionSettings.groupChatMode && currentSlots && slotId !== null && slotId !== undefined && currentSlots[slotId]) {
            currentSlots[slotId].usage = 0;
        }
        
        console.debug(`[KV Cache Manager] Кеш успешно загружен для слота ${slotId}, счетчик использования сброшен в 0`);
        return true;
    } catch (e) {
        if (e.name === 'AbortError') {
            console.error(`[KV Cache Manager] Таймаут при загрузке кеша слота ${slotId}`);
        } else {
            console.error(`[KV Cache Manager] Ошибка загрузки кеша слота ${slotId}:`, e);
        }
        return false;
    }
}

// Очистка кеша для слота
async function clearSlotCache(slotId) {
    const llamaUrl = getLlamaUrl();
    const url = `${llamaUrl}slots/${slotId}?action=erase`;
    
    console.debug(`[KV Cache Manager] Очистка кеша слота ${slotId}`);
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CLEAR_TIMEOUT_MS);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[KV Cache Manager] Ошибка очистки слота ${slotId}: ${response.status} ${errorText}`);
            return false;
        }
        
        console.debug(`[KV Cache Manager] Кеш успешно очищен для слота ${slotId}`);
        return true;
    } catch (e) {
        if (e.name === 'AbortError') {
            console.error(`[KV Cache Manager] Таймаут при очистке кеша слота ${slotId}`);
        } else {
            console.error(`[KV Cache Manager] Ошибка очистки слота ${slotId}:`, e);
        }
        return false;
    }
}

// Очистка всех слотов
async function clearAllSlots() {
    const llamaUrl = getLlamaUrl();
    
    try {
        // Получаем информацию о всех слотах
        const slotsData = await getAllSlotsInfo();
        
        if (!slotsData) {
            console.debug('[KV Cache Manager] Не удалось получить информацию о слотах для очистки');
            return false;
        }
        
        // Определяем общее количество слотов
        const totalSlots = getSlotsCountFromData(slotsData);
        
        if (totalSlots === 0) {
            console.debug('[KV Cache Manager] Нет слотов для очистки');
            return true;
        }
        
        console.debug(`[KV Cache Manager] Начинаю очистку ${totalSlots} слотов`);
        
        let clearedCount = 0;
        let errors = [];
        
        // Очищаем все слоты (от 0 до totalSlots - 1)
        for (let slotId = 0; slotId < totalSlots; slotId++) {
            try {
                if (await clearSlotCache(slotId)) {
                    clearedCount++;
                } else {
                    errors.push(`слот ${slotId}`);
                }
            } catch (e) {
                console.error(`[KV Cache Manager] Ошибка при очистке слота ${slotId}:`, e);
                errors.push(`слот ${slotId}: ${e.message}`);
            }
        }
        
        if (clearedCount > 0) {
            if (errors.length > 0) {
                console.warn(`[KV Cache Manager] Очищено ${clearedCount} из ${totalSlots} слотов. Ошибки: ${errors.join(', ')}`);
                showToast('warning', `Очищено ${clearedCount} из ${totalSlots} слотов. Ошибки: ${errors.join(', ')}`, 'Очистка кеша');
            } else {
                console.debug(`[KV Cache Manager] Успешно очищено ${clearedCount} слотов`);
                showToast('success', `Успешно очищено ${clearedCount} слотов`, 'Очистка кеша');
            }
            
            // Обновляем список слотов после очистки
            setTimeout(() => updateSlotsList(), 1000);
            
            return true;
        } else {
            console.error(`[KV Cache Manager] Не удалось очистить слоты. Ошибки: ${errors.join(', ')}`);
            showToast('error', `Не удалось очистить слоты. Ошибки: ${errors.join(', ')}`, 'Очистка кеша');
            return false;
        }
    } catch (e) {
        console.error('[KV Cache Manager] Ошибка при очистке всех слотов:', e);
        showToast('error', `Ошибка при очистке слотов: ${e.message}`, 'Очистка кеша');
        return false;
    }
}

// Получение списка файлов через API плагина kv_cache-manager-plugin
// Все файлы считываются напрямую из папки сохранений, метаданные не используются
async function getFilesList() {
    const llamaUrl = getLlamaUrl();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут
        
        // Обращаемся к API плагина для получения списка файлов
        const response = await fetch(`/api/plugins/kv-cache-manager/files`, {
            method: 'GET',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const data = await response.json();
            // Фильтруем только .bin файлы и не директории
            const binFiles = (data.files || []).filter(file => 
                file.name.endsWith('.bin') && !file.isDirectory
            );
            // Возвращаем объекты с именем и размером
            return binFiles.map(file => ({
                name: file.name,
                size: file.size || 0
            }));
        } else {
            console.error('[KV Cache Manager] Ошибка получения списка файлов:', response.status);
            showToast('error', 'Ошибка получения списка файлов с сервера');
            return [];
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error('[KV Cache Manager] Ошибка получения списка файлов:', e);
            showToast('error', 'Ошибка получения списка файлов: ' + e.message);
        }
        return [];
    }
}

// Группировка файлов по чатам, внутри каждого чата - по timestamp
// Возвращает объект: { [chatId]: [{ timestamp, tag, characterName, files }, ...] }
function groupFilesByChat(files) {
    const chats = {};
    
    // Парсим файлы один раз
    const parsedFiles = parseFilesList(files);
    
    for (const file of parsedFiles) {
        if (!file.parsed) {
            // Если не удалось распарсить, пропускаем этот файл
            console.warn('[KV Cache Manager] Не удалось распарсить имя файла:', file.name);
            continue;
        }
        
        const chatId = file.parsed.chatId;
        if (!chats[chatId]) {
            chats[chatId] = [];
        }
        
        // Ищем существующую группу с таким timestamp в этом чате
        let group = chats[chatId].find(g => g.timestamp === file.parsed.timestamp);
        if (!group) {
            group = {
                chatId: chatId,
                timestamp: file.parsed.timestamp,
                tag: file.parsed.tag || null,
                characterName: file.parsed.characterName || null,
                files: []
            };
            chats[chatId].push(group);
        }
        
        // Сохраняем объект файла с именем и размером
        group.files.push({
            name: file.name,
            size: file.size || 0
        });
    }
    
    // Сортируем файлы внутри каждого чата от новых к старым (по timestamp)
    for (const chatId in chats) {
        sortByTimestamp(chats[chatId]);
    }
    
    return chats;
}

// Общая функция сохранения кеша
// Сохраняет всех персонажей, которые находятся в слотах
async function saveCache(requestTag = false) {
    let tag = null;
    
    // Запрашиваем тег, если нужно
    if (requestTag) {
        tag = prompt('Введите тег для сохранения:');
        if (!tag || !tag.trim()) {
            if (tag !== null) {
                // Пользователь нажал OK, но не ввел тег
                showToast('error', 'Тег не может быть пустым');
            }
            return false; // Отмена сохранения
        }
        tag = tag.trim();
    }
    
    // Получаем нормализованный ID чата
    const chatId = getNormalizedChatId();
    
    showToast('info', 'Начинаю сохранение кеша...');
    
    // Получаем персонажей из слотов (они уже должны быть только из текущего чата)
    const charactersToSave = [];
    
    if (extensionSettings.groupChatMode && currentSlots) {
        // В режиме групповых чатов используем информацию о персонажах в слотах
        currentSlots.forEach((slot, slotIndex) => {
            const characterName = slot?.characterName;
            if (characterName && typeof characterName === 'string') {
                charactersToSave.push({
                    characterName: characterName,
                    slotIndex: slotIndex
                });
            }
        });
    } else {
        // В обычном режиме получаем активные слоты
        // Временное решение: используем первый активный слот для каждого персонажа
        // TODO: Реализовать распределение персонажей по слотам
        const activeSlots = await getActiveSlots();
        if (activeSlots.length > 0) {
            // В обычном режиме сохраняем только первый активный слот
            // Персонаж будет определен позже при реализации распределения
            charactersToSave.push({
                characterName: null, // Будет определено позже
                slotIndex: activeSlots[0]
            });
        }
    }
    
    if (charactersToSave.length === 0) {
        showToast('warning', 'Нет персонажей в слотах для сохранения');
        return false;
    }
    
    console.debug(`[KV Cache Manager] Начинаю сохранение ${charactersToSave.length} персонажей:`, charactersToSave);
    
    const successfullySaved = []; // Список успешно сохраненных персонажей
    const saveErrors = []; // Список персонажей с проблемами сохранения
    
    // Сохраняем каждого персонажа с индивидуальным timestamp
    for (const { characterName, slotIndex } of charactersToSave) {
        if (!characterName) {
            // Пропускаем, если имя персонажа не определено (временное решение для обычного режима)
            continue;
        }
        
        try {
            const timestamp = formatTimestamp();
            const filename = generateSaveFilename(chatId, timestamp, characterName, tag);
            
            console.debug(`[KV Cache Manager] Сохранение персонажа ${characterName} в слот ${slotIndex} с именем файла: ${filename}`);
            
            if (await saveSlotCache(slotIndex, filename, characterName)) {
                successfullySaved.push(characterName);
                console.debug(`[KV Cache Manager] Сохранен кеш для персонажа ${characterName}: ${filename}`);
                
                // Выполняем ротацию файлов для этого персонажа (только для автосохранений)
                if (!tag) {
                    await rotateCharacterFiles(characterName);
                }
            } else {
                saveErrors.push(characterName);
            }
        } catch (e) {
            console.error(`[KV Cache Manager] Ошибка при сохранении персонажа ${characterName}:`, e);
            saveErrors.push(`${characterName}: ${e.message}`);
        }
    }
    
    // Обновляем индикатор после автосохранения
    if (!tag && successfullySaved.length > 0) {
        updateNextSaveIndicator();
    }
    
    // Обновляем список слотов после сохранения
    if (successfullySaved.length > 0 || saveErrors.length > 0) {
        setTimeout(() => updateSlotsList(), 1000);
    }
    
    // Возвращаем true при успешном сохранении (хотя бы один персонаж сохранен)
    return successfullySaved.length > 0;
}

// Обработчики для кнопок
async function onSaveButtonClick() {
    await saveCache(true); // Запрашиваем имя пользователя
}

async function onSaveNowButtonClick() {
    const success = await saveCache(false); // Не запрашиваем имя пользователя
    if (success) {
        // Сбрасываем счётчики всех персонажей текущего чата после успешного сохранения
        const chatId = getNormalizedChatId();
        if (messageCounters[chatId]) {
            // Сбрасываем счетчики для всех персонажей в этом чате
            for (const characterName in messageCounters[chatId]) {
                messageCounters[chatId][characterName] = 0;
            }
        }
        updateNextSaveIndicator();
    }
}

let csrfTokenCache = null;

async function getCsrfToken() {
    if (csrfTokenCache) {
        return csrfTokenCache;
    }
    
    try {
        const response = await fetch('/csrf-token');
        if (response.ok) {
            const data = await response.json();
            if (data && data.token) {
                csrfTokenCache = data.token;
                return csrfTokenCache;
            }
        }
    } catch (e) {
        console.warn('[KV Cache Manager] Не удалось получить CSRF токен:', e);
    }
    
    return null;
}

async function deleteFile(filename) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут
        
        const url = `/api/plugins/kv-cache-manager/files/${filename}`;
        const csrfToken = await getCsrfToken();
        
        const headers = {};
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }
        
        const response = await fetch(url, {
            method: 'DELETE',
            headers: headers,
            credentials: 'same-origin',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            console.debug(`[KV Cache Manager] Файл удален: ${filename}`);
            return true;
        } else {
            console.warn(`[KV Cache Manager] Не удалось удалить файл ${filename}: ${response.status}`);
            return false;
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.warn(`[KV Cache Manager] Ошибка при удалении файла ${filename}:`, e);
        }
        return false;
    }
}

// Общая функция ротации файлов
// @param {Function} filterFn - функция фильтрации файлов: (file) => boolean
// @param {string} description - описание для логов и уведомлений (например, "для персонажа CharacterName" или "для чата")
// @param {string} context - контекст для логов (например, "персонажа CharacterName" или "чата")
async function rotateFiles(filterFn, description, context) {
    const chatId = getNormalizedChatId();
    const maxFiles = extensionSettings.maxFiles;
    
    try {
        // Получаем список всех файлов
        const filesList = await getFilesList();
        
        // Парсим файлы один раз и фильтруем
        const filteredFiles = parseFilesList(filesList).filter(filterFn);
        
        console.debug(`[KV Cache Manager] Найдено ${filteredFiles.length} автосохранений ${description} (лимит: ${maxFiles})`);
        
        // Сортируем по timestamp (от новых к старым)
        sortByTimestamp(filteredFiles);
        
        if (filteredFiles.length > maxFiles) {
            const filesToDelete = filteredFiles.slice(maxFiles);
            console.debug(`[KV Cache Manager] Удаление ${filesToDelete.length} старых автосохранений ${description}`);
            
            let deletedCount = 0;
            for (const file of filesToDelete) {
                const deleted = await deleteFile(file.name);
                if (deleted) {
                    deletedCount++;
                    console.debug(`[KV Cache Manager] Удален файл: ${file.name}`);
                }
            }
            
            if (deletedCount > 0 && extensionSettings.showNotifications) {
                showToast('warning', `Удалено ${deletedCount} старых автосохранений ${description}`, 'Ротация файлов');
            }
        } else {
            console.debug(`[KV Cache Manager] Ротация не требуется ${context}: ${filteredFiles.length} файлов <= ${maxFiles}`);
        }
    } catch (e) {
        console.error(`[KV Cache Manager] Ошибка при ротации файлов ${context}:`, e);
    }
}

// Ротация файлов для конкретного персонажа
async function rotateCharacterFiles(characterName) {
    if (!characterName) {
        return;
    }
    
    const normalizedName = normalizeCharacterName(characterName);
    const chatId = getNormalizedChatId();
    
    await rotateFiles(
        (file) => {
            if (!file.parsed) return false;
            const parsedNormalizedName = normalizeCharacterName(file.parsed.characterName || '');
            return file.parsed.chatId === chatId && 
                   parsedNormalizedName === normalizedName &&
                   !file.parsed.tag; // Только автосохранения (без тега)
        },
        `для персонажа ${characterName} в чате ${chatId}`,
        `для ${characterName}`
    );
}

// Ротация файлов: удаление старых автосохранений для текущего чата (старая функция, оставлена для обратной совместимости)
async function rotateAutoSaveFiles() {
    const chatId = getNormalizedChatId();
    
    await rotateFiles(
        (file) => {
            return file.parsed && 
                   file.parsed.chatId === chatId && 
                   !file.parsed.tag && 
                   !file.parsed.characterName; // Только автосохранения (без тега и без имени персонажа)
        },
        `для чата ${chatId}`,
        ''
    );
}

// Форматирование даты и времени из timestamp
function formatTimestampToDate(timestamp) {
    const date = new Date(
        parseInt(timestamp.substring(0, 4)), // год
        parseInt(timestamp.substring(4, 6)) - 1, // месяц (0-based)
        parseInt(timestamp.substring(6, 8)), // день
        parseInt(timestamp.substring(8, 10)), // час
        parseInt(timestamp.substring(10, 12)), // минута
        parseInt(timestamp.substring(12, 14)) // секунда
    );
    const dateStr = date.toLocaleDateString('ru-RU', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit' 
    });
    const timeStr = date.toLocaleTimeString('ru-RU', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit'
    });
    return `${dateStr} ${timeStr}`;
}

// Форматирование размера файла
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Парсинг списка файлов с добавлением распарсенных данных
// Возвращает массив файлов с добавленным полем parsed
// @param {Array} files - массив файлов (объекты с полем name или строки)
// @returns {Array} - массив файлов с добавленным полем parsed и гарантированным полем name
function parseFilesList(files) {
    return files.map(file => {
        const filename = file.name || file;
        const parsed = parseSaveFilename(filename);
        // Гарантируем наличие поля name в результате
        return { ...(typeof file === 'object' ? file : {}), name: filename, parsed };
    });
}

// Сортировка по timestamp
// Поддерживает как файлы с полем parsed.timestamp, так и объекты с полем timestamp
// @param {Array} items - массив файлов (с parsed.timestamp) или объектов (с timestamp)
// @param {boolean} descending - true для сортировки от новых к старым (по умолчанию), false для обратного порядка
// @returns {Array} - отсортированный массив
function sortByTimestamp(items, descending = true) {
    return items.sort((a, b) => {
        // Поддерживаем оба формата: parsed.timestamp (для файлов) и timestamp (для объектов)
        const timestampA = a.parsed?.timestamp || a.timestamp;
        const timestampB = b.parsed?.timestamp || b.timestamp;
        
        if (!timestampA || !timestampB) return 0;
        
        if (descending) {
            return timestampB.localeCompare(timestampA);
        } else {
            return timestampA.localeCompare(timestampB);
        }
    });
}

// Глобальные переменные для модалки загрузки
// Новая структура: { [chatId]: { [characterName]: [{ timestamp, filename, tag }, ...] } }
let loadModalData = {
    chats: {}, // Структура: { [chatId]: { [characterName]: [{ timestamp, filename, tag }, ...] } }
    currentChatId: null, // ID текущего чата (для отображения)
    selectedChatId: null, // ID выбранного чата в модалке (для загрузки)
    selectedCharacters: {}, // { [characterName]: timestamp } - выбранные персонажи и их timestamp
    searchQuery: ''
};

// Группировка файлов по чатам и персонажам
// Возвращает: { [chatId]: { [characterName]: [{ timestamp, filename, tag }, ...] } }
function groupFilesByChatAndCharacter(files) {
    const chats = {};
    
    // Парсим файлы один раз
    const parsedFiles = parseFilesList(files);
    
    for (const file of parsedFiles) {
        if (!file.parsed) {
            continue;
        }
        
        const chatId = file.parsed.chatId;
        const characterName = file.parsed.characterName || 'Unknown';
        
        if (!chats[chatId]) {
            chats[chatId] = {};
        }
        
        if (!chats[chatId][characterName]) {
            chats[chatId][characterName] = [];
        }
        
        chats[chatId][characterName].push({
            timestamp: file.parsed.timestamp,
            filename: file.name,
            tag: file.parsed.tag || null
        });
    }
    
    // Сортируем timestamp для каждого персонажа (от новых к старым)
    for (const chatId in chats) {
        for (const characterName in chats[chatId]) {
            sortByTimestamp(chats[chatId][characterName]);
        }
    }
    
    return chats;
}

// Открытие модалки загрузки
async function openLoadModal() {
    const modal = $("#kv-cache-load-modal");
    modal.css('display', 'flex');
    
    // Показываем загрузку
    $("#kv-cache-load-files-list").html('<div class="kv-cache-load-loading"><i class="fa-solid fa-spinner"></i> Загрузка файлов...</div>');
    
    // Получаем список файлов
    const filesList = await getFilesList();
    
    if (!filesList || filesList.length === 0) {
        $("#kv-cache-load-files-list").html('<div class="kv-cache-load-empty">Не найдено сохранений для загрузки. Сначала сохраните кеш.</div>');
        showToast('warning', 'Не найдено сохранений для загрузки');
        return;
    }
    
    // Группируем файлы по чатам и персонажам
    loadModalData.chats = groupFilesByChatAndCharacter(filesList);
    // Получаем нормализованный chatId
    loadModalData.currentChatId = getNormalizedChatId();
    loadModalData.selectedChatId = null; // Сбрасываем выбранный чат
    loadModalData.selectedCharacters = {};
    
    // Отображаем чаты и файлы
    renderLoadModalChats();
    selectLoadModalChat('current');
}

// Закрытие модалки загрузки
function closeLoadModal() {
    const modal = $("#kv-cache-load-modal");
    modal.css('display', 'none');
    loadModalData.selectedCharacters = {};
    loadModalData.searchQuery = '';
    $("#kv-cache-load-search-input").val('');
    $("#kv-cache-load-confirm-button").prop('disabled', true);
    $("#kv-cache-load-selected-info").text('Персонажи не выбраны');
}

// Отображение списка чатов
function renderLoadModalChats() {
    const chatsList = $("#kv-cache-load-chats-list");
    const currentChatId = loadModalData.currentChatId;
    const chats = loadModalData.chats;
    
    // Обновляем ID и счетчик для текущего чата
    const currentChatCharacters = chats[currentChatId] || {};
    const currentCount = Object.values(currentChatCharacters).reduce((sum, files) => sum + files.length, 0);
    // Отображаем исходное имя чата (до нормализации) для читаемости
    const rawChatId = getCurrentChatId() || 'unknown';
    $(".kv-cache-load-chat-item-current .kv-cache-load-chat-name-text").text(rawChatId + ' [текущий]');
    $(".kv-cache-load-chat-item-current .kv-cache-load-chat-count").text(currentCount > 0 ? currentCount : '-');
    
    // Фильтруем чаты по поисковому запросу
    const searchQuery = loadModalData.searchQuery.toLowerCase();
    const filteredChats = Object.keys(chats).filter(chatId => {
        if (chatId === currentChatId) return true;
        if (searchQuery && !chatId.toLowerCase().includes(searchQuery)) return false;
        return true;
    });
    
    // Очищаем список
    chatsList.empty();
    
    // Добавляем другие чаты
    for (const chatId of filteredChats) {
        if (chatId === currentChatId) continue;
        
        const chatCharacters = chats[chatId] || {};
        const totalFiles = Object.values(chatCharacters).reduce((sum, files) => sum + files.length, 0);
        
        const chatItem = $(`
            <div class="kv-cache-load-chat-item" data-chat-id="${chatId}">
                <div class="kv-cache-load-chat-name">
                    <i class="fa-solid fa-comment" style="margin-right: 5px;"></i>
                    ${chatId}
                </div>
                <div class="kv-cache-load-chat-count">${totalFiles}</div>
            </div>
        `);
        
        chatItem.on('click', () => selectLoadModalChat(chatId));
        chatsList.append(chatItem);
    }
}

// Выбор чата в модалке
function selectLoadModalChat(chatId) {
    // Убираем активный класс со всех чатов
    $(".kv-cache-load-chat-item").removeClass('active');
    
    // Устанавливаем активный класс и сохраняем выбранный чат
    if (chatId === 'current') {
        $(".kv-cache-load-chat-item-current").addClass('active');
        chatId = loadModalData.currentChatId;
    } else {
        $(`.kv-cache-load-chat-item[data-chat-id="${chatId}"]`).addClass('active');
    }
    
    // Сохраняем выбранный чат для использования при загрузке
    loadModalData.selectedChatId = chatId;
    
    // Отображаем персонажей выбранного чата
    renderLoadModalFiles(chatId);
    
    // Сбрасываем выбор
    loadModalData.selectedCharacters = {};
    $("#kv-cache-load-confirm-button").prop('disabled', true);
    $("#kv-cache-load-selected-info").text('Персонажи не выбраны');
}

// Отображение персонажей выбранного чата
function renderLoadModalFiles(chatId) {
    const filesList = $("#kv-cache-load-files-list");
    const chats = loadModalData.chats;
    const chatCharacters = chats[chatId] || {};
    const searchQuery = loadModalData.searchQuery.toLowerCase();
    
    const characterNames = Object.keys(chatCharacters);
    
    if (characterNames.length === 0) {
        filesList.html('<div class="kv-cache-load-empty">Нет файлов для этого чата</div>');
        return;
    }
    
    // Фильтруем персонажей по поисковому запросу
    const filteredCharacters = characterNames.filter(characterName => {
        if (!searchQuery) return true;
        return characterName.toLowerCase().includes(searchQuery);
    });
    
    if (filteredCharacters.length === 0) {
        filesList.html('<div class="kv-cache-load-empty">Не найдено персонажей по запросу</div>');
        return;
    }
    
    // Сортируем персонажей: сначала те, что распределены в слоты (только для текущего чата)
    const isCurrentChat = chatId === loadModalData.currentChatId;
    if (isCurrentChat && extensionSettings.groupChatMode && currentSlots) {
        const slots = currentSlots;
        // Создаем Set нормализованных имен из слотов для корректного сравнения
        const slotsCharacters = new Set(
            slots
                .map(slot => slot?.characterName)
                .filter(name => name && typeof name === 'string')
                .map(name => normalizeCharacterName(name))
        );
        
        filteredCharacters.sort((a, b) => {
            // Нормализуем имена для сравнения (имена из файлов уже нормализованы, но на всякий случай)
            const normalizedA = normalizeCharacterName(a);
            const normalizedB = normalizeCharacterName(b);
            const aInSlots = slotsCharacters.has(normalizedA);
            const bInSlots = slotsCharacters.has(normalizedB);
            
            // Персонажи в слотах идут первыми
            if (aInSlots && !bInSlots) return -1;
            if (!aInSlots && bInSlots) return 1;
            
            // Если оба в слотах или оба не в слотах, сохраняем исходный порядок
            return 0;
        });
    }
    
    filesList.empty();
    
    // Отображаем персонажей с их timestamp
    for (const characterName of filteredCharacters) {
        const characterFiles = chatCharacters[characterName];
        
        const characterElement = $(`
            <div class="kv-cache-load-file-group collapsed" data-character-name="${characterName}">
                <div class="kv-cache-load-file-group-header">
                    <div class="kv-cache-load-file-group-title">
                        <i class="fa-solid fa-user"></i>
                        ${characterName}
                    </div>
                    <div class="kv-cache-load-file-group-info">
                        <span>${characterFiles.length} сохранени${characterFiles.length !== 1 ? 'й' : 'е'}</span>
                        <i class="fa-solid fa-chevron-down kv-cache-load-file-group-toggle"></i>
                    </div>
                </div>
                <div class="kv-cache-load-file-group-content">
                </div>
            </div>
        `);
        
        // Добавляем timestamp для этого персонажа
        const content = characterElement.find('.kv-cache-load-file-group-content');
        for (const file of characterFiles) {
            const dateTime = formatTimestampToDate(file.timestamp);
            const tagLabel = file.tag ? ` [тег: ${file.tag}]` : '';
            
            const timestampItem = $(`
                <div class="kv-cache-load-file-item" data-character-name="${characterName}" data-timestamp="${file.timestamp}" data-filename="${file.filename}">
                    <div class="kv-cache-load-file-item-info">
                        <div class="kv-cache-load-file-item-name">
                            <i class="fa-solid fa-calendar"></i>
                            ${dateTime}${tagLabel}
                        </div>
                    </div>
                </div>
            `);
            
            // Проверяем, является ли это сохранение выбранным
            const isSelected = loadModalData.selectedCharacters[characterName] === file.timestamp;
            if (isSelected) {
                timestampItem.addClass('selected');
            }
            
            timestampItem.on('click', function(e) {
                e.stopPropagation();
                
                // Убираем выделение с других сохранений этого персонажа
                $(`.kv-cache-load-file-item[data-character-name="${characterName}"]`).removeClass('selected');
                
                // Выделяем выбранное сохранение
                timestampItem.addClass('selected');
                
                // Выбираем этот timestamp для персонажа
                const selectedTimestamp = file.timestamp;
                loadModalData.selectedCharacters[characterName] = selectedTimestamp;
                
                // Обновляем UI
                updateLoadModalSelection();
            });
            
            content.append(timestampItem);
        }
        
        // Обработчик сворачивания/разворачивания
        characterElement.find('.kv-cache-load-file-group-header').on('click', function(e) {
            if ($(e.target).closest('.kv-cache-load-file-item').length) return;
            
            if ($(e.target).hasClass('kv-cache-load-file-group-toggle') || 
                $(e.target).closest('.kv-cache-load-file-group-title').length ||
                $(e.target).closest('.kv-cache-load-file-group-info').length) {
                characterElement.toggleClass('collapsed');
            }
        });
        
        filesList.append(characterElement);
    }
}

// Обновление информации о выбранных персонажах
function updateLoadModalSelection() {
    const selectedCount = Object.keys(loadModalData.selectedCharacters).length;
    
    if (selectedCount === 0) {
        $("#kv-cache-load-confirm-button").prop('disabled', true);
        $("#kv-cache-load-selected-info").text('Персонажи не выбраны');
    } else {
        $("#kv-cache-load-confirm-button").prop('disabled', false);
        const charactersList = Object.keys(loadModalData.selectedCharacters).join(', ');
        $("#kv-cache-load-selected-info").html(`<strong>Выбрано:</strong> ${selectedCount} персонаж${selectedCount !== 1 ? 'ей' : ''} (${charactersList})`);
    }
}

// Получение последнего файла для чата
async function getLastFileForChat(chatId) {
    try {
        const filesList = await getFilesList();
        if (!filesList || filesList.length === 0) {
            return null;
        }
        
        const chats = groupFilesByChat(filesList);
        const chatGroups = chats[chatId] || [];
        
        if (chatGroups.length === 0) {
            return null;
        }
        
        // Возвращаем самую новую группу (первая в отсортированном массиве)
        return chatGroups[0];
    } catch (e) {
        console.error('[KV Cache Manager] Ошибка при получении последнего файла для чата:', e);
        return null;
    }
}

// Получение последнего кеша для персонажа
// @param {string} characterName - имя персонажа
// @param {boolean} currentChatOnly - искать только в текущем чате (по умолчанию true)
async function getLastCacheForCharacter(characterName, currentChatOnly = true) {
    try {
        const filesList = await getFilesList();
        if (!filesList || filesList.length === 0) {
            return null;
        }
        
        // Нормализуем имя персонажа для сравнения
        const normalizedCharacterName = normalizeCharacterName(characterName);
        
        // Получаем chatId текущего чата для фильтрации (если нужно)
        const currentChatId = currentChatOnly ? getNormalizedChatId() : null;
        
        // Парсим файлы один раз и фильтруем
        const parsedFiles = parseFilesList(filesList);
        
        // Ищем файлы, содержащие имя персонажа
        const characterFiles = [];
        
        for (const file of parsedFiles) {
            if (!file.parsed) {
                continue;
            }
            
            // Фильтруем по чату, если нужно
            if (currentChatOnly && file.parsed.chatId !== currentChatId) {
                continue;
            }
            
            // Проверяем по characterName в имени файла (основной способ для режима групповых чатов)
            if (file.parsed.characterName) {
                const normalizedParsedName = normalizeCharacterName(file.parsed.characterName);
                if (normalizedParsedName === normalizedCharacterName) {
                    characterFiles.push({
                        filename: file.name,
                        timestamp: file.parsed.timestamp,
                        chatId: file.parsed.chatId
                    });
                    continue; // Найден по characterName, не нужно проверять fallback
                }
            }
            
            // Также проверяем по имени файла (fallback, менее надежный способ)
            if (file.name.includes(normalizedCharacterName) || file.name.includes(characterName)) {
                // Убеждаемся, что это не дубликат
                const alreadyAdded = characterFiles.some(f => f.filename === file.name);
                if (!alreadyAdded) {
                    characterFiles.push({
                        filename: file.name,
                        timestamp: file.parsed.timestamp,
                        chatId: file.parsed.chatId
                    });
                }
            }
        }
        
        if (characterFiles.length === 0) {
            console.debug(`[KV Cache Manager] Не найдено кеша для персонажа ${characterName}${currentChatOnly ? ` в чате ${currentChatId}` : ''}`);
            return null;
        }
        
        // Сортируем по timestamp (от новых к старым)
        sortByTimestamp(characterFiles);
        
        // Возвращаем самый последний файл
        const lastFile = characterFiles[0];
        console.debug(`[KV Cache Manager] Найден последний кеш для персонажа ${characterName}: ${lastFile.filename}${currentChatOnly ? ` (в текущем чате)` : ' (во всех чатах)'}`);
        
        return {
            filename: lastFile.filename,
        };
    } catch (e) {
        console.error(`[KV Cache Manager] Ошибка при поиске кеша для персонажа ${characterName}:`, e);
        return null;
    }
}

// Загрузка группы файлов (используется и для автозагрузки, и для ручной загрузки)
async function loadFileGroup(group, chatId) {
    if (!group || !group.files || group.files.length === 0) {
        return false;
    }
    
    // Инициализируем слоты, если режим групповых чатов включен
    if (extensionSettings.groupChatMode) {
        if (!currentSlots || currentSlots.length === 0) {
            await initializeSlots();
        }
    }
    
    // Подготавливаем файлы для загрузки
    const filesToLoad = [];
    for (const file of group.files) {
        const filename = file.name;
        const parsed = parseSaveFilename(filename);
        
        if (!parsed) {
            console.warn('[KV Cache Manager] Не удалось распарсить имя файла для загрузки:', filename);
            continue;
        }
        
        // Файл должен иметь characterName
        if (!parsed.characterName) {
            console.warn(`[KV Cache Manager] Файл ${filename} не содержит имя персонажа, пропускаем`);
            continue;
        }
        
        // Загружаем кеш для персонажей, используя существующие слоты или выделяя новые
        if (extensionSettings.groupChatMode) {
            // Проверяем, есть ли персонаж в слотах (сравниваем нормализованные имена)
            const parsedNormalizedName = normalizeCharacterName(parsed.characterName || '');
            let slotIndex = currentSlots ? currentSlots.findIndex(slot => {
                const slotName = slot?.characterName;
                return slotName && normalizeCharacterName(slotName) === parsedNormalizedName;
            }) : -1;
            
            if (slotIndex !== -1) {
                // Персонаж уже в слотах - загружаем кеш в существующий слот
                console.debug(`[KV Cache Manager] Персонаж ${parsed.characterName} уже в слоте ${slotIndex}, загружаю кеш`);
            } else {
                // Персонаж не в слотах - выделяем новый слот по общей логике (ручная загрузка, не генерация - счетчик = 0)
                console.debug(`[KV Cache Manager] Персонаж ${parsed.characterName} не в слотах, выделяю новый слот для загрузки кеша`);
                slotIndex = await acquireSlot(parsed.characterName);
                
                if (slotIndex === null) {
                    console.warn(`[KV Cache Manager] Не удалось получить слот для персонажа ${parsed.characterName}, пропускаем загрузку кеша`);
                    continue;
                }
            }
            
            // Счетчик будет сброшен в 0 в loadSlotCache при загрузке кеша
            // Сохраняем распарсенные данные, чтобы не парсить повторно
            filesToLoad.push({
                filename: filename,
                slotId: slotIndex,
                characterName: parsed.characterName,
                timestamp: parsed.timestamp,
                parsed: parsed // Сохраняем распарсенные данные
            });
        } else {
            // В обычном режиме используем первый активный слот
            const activeSlots = await getActiveSlots();
            if (activeSlots.length > 0) {
                filesToLoad.push({
                    filename: filename,
                    slotId: activeSlots[0],
                    characterName: parsed.characterName,
                    timestamp: parsed.timestamp,
                    parsed: parsed // Сохраняем распарсенные данные
                });
            } else {
                console.warn(`[KV Cache Manager] Нет активных слотов для загрузки файла ${filename}`);
                continue;
            }
        }
    }
    
    if (filesToLoad.length === 0) {
        console.warn('[KV Cache Manager] Нет файлов для загрузки после обработки');
        return false;
    }
    
    console.debug(`[KV Cache Manager] Начинаю загрузку ${filesToLoad.length} файлов:`, filesToLoad);
    
    let loadedCount = 0;
    let errors = [];
    const successfullyLoaded = []; // Список успешно загруженных персонажей с датой-временем
    
    for (const { filename, slotId, characterName, timestamp, parsed: fileParsed } of filesToLoad) {
        if (slotId === null || slotId === undefined) {
            errors.push(`слот null (файл: ${filename})`);
            continue;
        }
        
        try {
            if (await loadSlotCache(slotId, filename)) {
                loadedCount++;
                console.debug(`[KV Cache Manager] Загружен кеш для слота ${slotId} из файла ${filename}`);
                
                // Используем уже распарсенные данные, если они есть, иначе парсим
                const parsed = fileParsed || parseSaveFilename(filename);
                
                // Форматируем дату-время из timestamp для тоста
                let dateTimeStr = '';
                if (timestamp) {
                    dateTimeStr = formatTimestampToDate(timestamp);
                } else if (parsed && parsed.timestamp) {
                    dateTimeStr = formatTimestampToDate(parsed.timestamp);
                }
                
                const displayName = characterName || `слот ${slotId}`;
                const dateTimeLabel = dateTimeStr ? ` (${dateTimeStr})` : '';
                
                // Показываем информацию о чате, если кеш загружен из другого чата
                const currentChatId = getNormalizedChatId();
                const cacheChatId = parsed?.chatId;
                const chatInfo = cacheChatId && cacheChatId !== currentChatId ? ` (из чата ${cacheChatId})` : '';
                
                successfullyLoaded.push({ name: displayName, dateTime: dateTimeStr });
                
                showToast('success', `Загружен кеш для ${displayName} ${dateTimeLabel}${chatInfo}`, 'Загрузка кеша');
            } else {
                errors.push(characterName || `слот ${slotId}`);
            }
        } catch (e) {
            console.error(`[KV Cache Manager] Ошибка при загрузке слота ${slotId}:`, e);
            errors.push(characterName ? `${characterName}: ${e.message}` : `слот ${slotId}: ${e.message}`);
        }
    }
    
    if (loadedCount > 0) {
        // Запоминаем чат при любой успешной загрузке (автоматической или ручной)
        // Но не запоминаем, если включена очистка слотов при переключении чата
        if (!extensionSettings.clearSlotsOnChatSwitch) {
            lastLoadedChatId = chatId;
        }
        
        // Обновляем список слотов после загрузки
        setTimeout(() => updateSlotsList(), 1000);
        return true;
    } else {
        showToast('error', `Не удалось загрузить кеш. Ошибки: ${errors.join(', ')}`, 'Автозагрузка');
        return false;
    }
}

// Модалка подтверждения автозагрузки
let autoLoadConfirmModalData = null;

function openAutoLoadConfirmModal(group, chatId, chatName) {
    const modal = $("#kv-cache-auto-load-confirm-modal");
    modal.css('display', 'flex');
    
    const dateTime = formatTimestampToDate(group.timestamp);
    const slotsCount = group.files.length;
    const tagLabel = group.tag ? ` [тег: ${group.tag}]` : '';
    const characterLabel = group.characterName ? ` [персонаж: ${group.characterName}]` : '';
    const label = tagLabel || characterLabel;
    
    $("#kv-cache-auto-load-confirm-info").html(`
        Загрузить сохранение от <strong>${dateTime}${label}</strong> (${slotsCount} слот${slotsCount !== 1 ? 'ов' : ''}) для чата <strong>${chatName}</strong>?
    `);
    
    autoLoadConfirmModalData = { group, chatId };
}

function closeAutoLoadConfirmModal() {
    const modal = $("#kv-cache-auto-load-confirm-modal");
    modal.css('display', 'none');
    
    // При отмене не записываем ничего - при следующем входе в чат снова предложим
    autoLoadConfirmModalData = null;
}

async function confirmAutoLoad() {
    if (!autoLoadConfirmModalData) {
        return;
    }
    
    const { group, chatId } = autoLoadConfirmModalData;
    closeAutoLoadConfirmModal();
    
    showToast('info', 'Начинаю загрузку кеша...', 'Автозагрузка');
    // Запоминание чата происходит в loadFileGroup при успешной загрузке
    await loadFileGroup(group, chatId);
}

// Автозагрузка последнего файла при переключении чата
async function tryAutoLoadOnChatSwitch(chatId) {
    
    // Не предлагаем автозагрузку для чата "unknown"
    if (chatId === 'unknown' || !chatId) {
        console.debug(`[KV Cache Manager] Пропускаем автозагрузку для чата "unknown"`);
        return;
    }
    
    // Проверяем, не загружали ли мы уже этот чат в текущей сессии
    if (lastLoadedChatId === chatId) {
        console.debug(`[KV Cache Manager] Чат ${chatId} уже загружался в этой сессии, пропускаем автозагрузку`);
        return;
    }
    
    // Получаем последний файл для чата
    // Проверяем наличие файлов ДО показа модалки
    const lastGroup = await getLastFileForChat(chatId);
    
    if (!lastGroup) {
        console.debug(`[KV Cache Manager] Не найдено сохранений для чата ${chatId}`);
        return;
    }
    
    const rawChatId = getCurrentChatId() || chatId;
    
    // Если нужно подтверждение
    if (extensionSettings.autoLoadAskConfirmation) {
        openAutoLoadConfirmModal(lastGroup, chatId, rawChatId);
    } else {
        // Загружаем без подтверждения
        showToast('info', 'Начинаю автозагрузку кеша...', 'Автозагрузка');
        // Запоминание чата происходит в loadFileGroup при успешной загрузке
        await loadFileGroup(lastGroup, chatId);
    }
}

// Загрузка выбранного кеша
async function loadSelectedCache() {
    const selectedCharacters = loadModalData.selectedCharacters;
    
    if (!selectedCharacters || Object.keys(selectedCharacters).length === 0) {
        showToast('error', 'Персонажи не выбраны');
        return;
    }
    
    // Используем выбранный чат из модалки, если он был выбран, иначе используем текущий
    const selectedChatId = loadModalData.selectedChatId || loadModalData.currentChatId || getNormalizedChatId();
    const chats = loadModalData.chats;
    const chatCharacters = chats[selectedChatId] || {};
    
    closeLoadModal();
    
    let loadedCount = 0;
    let errors = [];
    
    // Инициализируем слоты, если режим групповых чатов включен
    if (extensionSettings.groupChatMode) {
        if (!currentSlots || currentSlots.length === 0) {
            await initializeSlots();
        }
        
        // Проверяем, что не выбрано больше персонажей, чем доступно слотов
        const selectedCount = Object.keys(selectedCharacters).length;
        const totalSlots = currentSlots.length;
        
        if (selectedCount > totalSlots) {
            showToast('error', `Выбрано ${selectedCount} персонажей, но доступно только ${totalSlots} слотов. Выберите не более ${totalSlots} персонажей.`);
            return;
        }
    }
    
    showToast('info', `Начинаю загрузку кешей для ${Object.keys(selectedCharacters).length} персонажей...`, 'Загрузка');
    
    // TODO: сделать снятие выбора с персонажей при загрузке
    
    // Загружаем кеши для каждого выбранного персонажа
    for (const characterName in selectedCharacters) {
        const selectedTimestamp = selectedCharacters[characterName];
        const characterFiles = chatCharacters[characterName] || [];
        
        // Находим файл с выбранным timestamp
        const fileToLoad = characterFiles.find(f => f.timestamp === selectedTimestamp);
        
        if (!fileToLoad) {
            errors.push(`${characterName}: файл не найден`);
            continue;
        }
        
        try {
            let slotIndex = null;
            
            if (extensionSettings.groupChatMode) {
                // Проверяем, есть ли персонаж в слотах (сравниваем нормализованные имена)
                const normalizedName = normalizeCharacterName(characterName);
                slotIndex = currentSlots ? currentSlots.findIndex(slot => {
                    const slotName = slot?.characterName;
                    return slotName && normalizeCharacterName(slotName) === normalizedName;
                }) : -1;
                
                if (slotIndex !== -1) {
                    // Персонаж уже в слотах - загружаем кеш в существующий слот
                    console.debug(`[KV Cache Manager] Персонаж ${characterName} уже в слоте ${slotIndex}, загружаю кеш в этот же слот`);
                } else {
                    // Персонаж не в слотах - выделяем новый слот по общей логике (ручная загрузка, не генерация - счетчик = 0)
                    console.debug(`[KV Cache Manager] Персонаж ${characterName} не в слотах, выделяю новый слот для загрузки кеша`);
                    console.debug(`[KV Cache Manager] Текущие слоты:`, currentSlots);
                    slotIndex = await acquireSlot(characterName);
                    
                    if (slotIndex === null) {
                        errors.push(`${characterName}: не удалось получить слот`);
                        continue;
                    }
                    
                    console.debug(`[KV Cache Manager] Персонаж ${characterName} помещен в слот ${slotIndex}`);
                }
                
                // Счетчик будет сброшен в 0 в loadSlotCache при загрузке кеша
            } else {
                // В обычном режиме используем первый активный слот
                const activeSlots = await getActiveSlots();
                if (activeSlots.length > 0) {
                    slotIndex = activeSlots[0];
                } else {
                    errors.push(`${characterName}: нет активных слотов`);
                    continue;
                }
            }
            
            // Загружаем кеш
            const loaded = await loadSlotCache(slotIndex, fileToLoad.filename);
            
            if (loaded) {
                loadedCount++;
                console.debug(`[KV Cache Manager] Загружен кеш для персонажа ${characterName} в слот ${slotIndex}`);
                
                // Парсим имя файла один раз для получения информации о чате
                const parsed = parseSaveFilename(fileToLoad.filename);
                
                // Форматируем дату-время из timestamp для тоста
                const dateTimeStr = formatTimestampToDate(fileToLoad.timestamp);
                
                // Показываем информацию о чате, если кеш загружен из другого чата
                const currentChatId = getNormalizedChatId();
                const cacheChatId = parsed?.chatId;
                const chatInfo = cacheChatId && cacheChatId !== currentChatId ? ` (из чата ${cacheChatId})` : '';
                
                // Выводим тост для каждого успешно загруженного персонажа
                if (extensionSettings.showNotifications) {
                    showToast('success', `Загружен кеш для ${characterName} (${dateTimeStr})${chatInfo}`, 'Загрузка кеша');
                }
            } else {
                errors.push(`${characterName}: ошибка загрузки`);
            }
        } catch (e) {
            console.error(`[KV Cache Manager] Ошибка при загрузке кеша для персонажа ${characterName}:`, e);
            errors.push(`${characterName}: ${e.message}`);
        }
    }
    
    // Показываем результат
    if (loadedCount > 0) {
        if (errors.length > 0) {
            showToast('warning', `Загружено ${loadedCount} из ${Object.keys(selectedCharacters).length} персонажей. Ошибки: ${errors.join(', ')}`, 'Загрузка');
        } else {
            showToast('success', `Успешно загружено ${loadedCount} персонажей`, 'Загрузка');
        }
        
        // Обновляем список слотов
        setTimeout(() => updateSlotsList(), 1000);
    } else {
        showToast('error', `Не удалось загрузить кеши. Ошибки: ${errors.join(', ')}`, 'Загрузка');
    }
}

async function onLoadButtonClick() {
    await openLoadModal();
}

// Предзагрузка всех персонажей группы
async function preloadAllGroupCharacters() {
    if (!extensionSettings.groupChatMode) {
        showToast('warning', 'Режим групповых чатов отключен');
        return;
    }
    
    if (!characters || characters.length === 0) {
        showToast('warning', 'Не найдено персонажей для предзагрузки');
        return;
    }
    
    showToast('info', `Начинаю предзагрузку ${characters.length} персонажей...`, 'Предзагрузка');
    
    let loadedCount = 0;
    let errors = [];
    
    // Инициализируем слоты, если еще не инициализированы
    if (!currentSlots || currentSlots.length === 0) {
        await initializeSlots();
    }
    
    for (const character of characters) {
        if (!character || !character.name) {
            continue;
        }
        
        const characterName = character.name;
        console.debug(`[KV Cache Manager] Обрабатываю персонажа ${characterName}...`);
        
        try {
            // Ищем кеш персонажа во всех чатах, чтобы можно было загрузить кеш из другого чата
            const cacheInfo = await getLastCacheForCharacter(characterName, false);
            
            if (cacheInfo) {
                // Получаем слот для персонажа (предзагрузка, не генерация - счетчик = 0)
                // acquireSlot теперь async и сам сохраняет кеш вытесняемого персонажа
                const slotIndex = await acquireSlot(characterName);
                
                if (slotIndex !== null) {
                    // Загружаем кеш персонажа
                    const loaded = await loadSlotCache(slotIndex, cacheInfo.filename);
                    
                    if (loaded) {
                        loadedCount++;
                        // Показываем информацию о чате, если кеш загружен из другого чата
                        const parsed = parseSaveFilename(cacheInfo.filename);
                        const currentChatId = getNormalizedChatId();
                        const cacheChatId = parsed?.chatId;
                        const chatInfo = cacheChatId && cacheChatId !== currentChatId ? ` (из чата ${cacheChatId})` : '';
                        console.debug(`[KV Cache Manager] Предзагружен кеш для персонажа ${characterName} в слот ${slotIndex}${chatInfo}`);
                    } else {
                        errors.push(characterName);
                        console.warn(`[KV Cache Manager] Не удалось загрузить кеш для персонажа ${characterName}`);
                    }
                } else {
                    errors.push(characterName);
                    console.warn(`[KV Cache Manager] Не удалось получить слот для персонажа ${characterName}`);
                }
            } else {
                console.debug(`[KV Cache Manager] Кеш для персонажа ${characterName} не найден, пропускаем`);
            }
        } catch (e) {
            console.error(`[KV Cache Manager] Ошибка при предзагрузке персонажа ${characterName}:`, e);
            errors.push(characterName);
        }
    }
    
    // Обновляем UI
    updateSlotsAvailability();
    
    // Показываем результат
    if (loadedCount > 0) {
        if (errors.length > 0) {
            showToast('warning', `Предзагружено ${loadedCount} из ${characters.length} персонажей. Ошибки: ${errors.length}`, 'Предзагрузка');
        } else {
            showToast('success', `Успешно предзагружено ${loadedCount} персонажей`, 'Предзагрузка');
        }
    } else {
        showToast('warning', 'Не удалось предзагрузить ни одного персонажа', 'Предзагрузка');
    }
}

async function onPreloadCharactersButtonClick() {
    await preloadAllGroupCharacters();
}

async function onReleaseAllSlotsButtonClick() {
    if (!extensionSettings.groupChatMode) {
        showToast('warning', 'Режим групповых чатов отключен');
        return;
    }
    
    releaseAllSlots();
    showToast('success', 'Все слоты освобождены', 'Режим групповых чатов');
}

// Функция вызывается при загрузке расширения
jQuery(async () => {
    // Загружаем HTML из файла
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $("#extensions_settings").append(settingsHtml);
    
    // Загружаем модалку подтверждения автозагрузки из файла
    const autoLoadConfirmModalHtml = await $.get(`${extensionFolderPath}/auto-load-confirm-modal.html`);
    $("body").append(autoLoadConfirmModalHtml);

    // Загружаем настройки при старте
    loadSettings();
    updateSlotsList();
    
    // Инициализируем счетчик для текущего чата
    const initialChatId = getNormalizedChatId();
    if (!messageCounters[initialChatId]) {
        messageCounters[initialChatId] = 0;
    }
    updateNextSaveIndicator();
    
    // Считываем все файлы при загрузке через API плагина (для проверки доступности)
    try {
        const filesList = await getFilesList();
        console.debug(`[KV Cache Manager] При загрузке найдено ${filesList.length} файлов сохранений`);
    } catch (e) {
        console.debug('[KV Cache Manager] Не удалось получить список файлов при загрузке (возможно, API плагина недоступен):', e);
    }
    
    // Инициализация слотов при готовности приложения
    eventSource.on(event_types.APP_READY, async () => {
        if (extensionSettings.groupChatMode) {
            await initializeSlots();
            await assignCharactersToSlots();
        }
    });
    
    // Обновляем список слотов при запуске генерации
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, async (data) => {
        updateSlotsList();
    });
    
    // Обработчик для установки id_slot в режиме групповых чатов
    eventSource.on(event_types.TEXT_COMPLETION_SETTINGS_READY, (params) => {
        if (extensionSettings.groupChatMode && currentSlot !== null) {
            params["id_slot"] = currentSlot;
            console.debug(`[KV Cache Manager] Установлен id_slot = ${currentSlot} для генерации`);
        }
    });
    
    // Функция-перехватчик генерации для загрузки кеша
    /**
     * Перехватчик генерации для загрузки кеша персонажа в слоты
     * @param {any[]} chat - Массив сообщений чата
     * @param {number} contextSize - Размер контекста
     * @param {function(boolean): void} abort - Функция для остановки генерации
     * @param {string} type - Тип генерации ('normal', 'regenerate', 'swipe', 'quiet', 'impersonate', 'continue')
     */
    async function KVCacheManagerInterceptor(chat, contextSize, abort, type) {
        // Пропускаем тихие генерации и impersonate
        if (type === 'quiet' || type === 'impersonate') {
            return;
        }
        
        // Работаем только в режиме групповых чатов
        if (!extensionSettings.groupChatMode) {
            return;
        }
        
        try {
            const context = getContext();
            
            if (!context || !context.characterId) {
                return;
            }
            
            const character = context.characters[context.characterId];
            if (!character || !character.name) {
                return;
            }
            
            const characterName = character.name;
            
            // Проверяем, был ли персонаж уже в слоте ДО получения слота
            // Это нужно, чтобы не загружать кеш, если персонаж уже был в слоте (например, после ручной загрузки)
            const wasAlreadyInSlot = findCharacterSlotIndex(characterName) !== null;
            
            currentSlot = await acquireSlot(characterName);
            
            if (currentSlot === null) {
                console.warn(`[KV Cache Manager] Не удалось получить слот для персонажа ${characterName} при генерации`);
                showToast('error', `Не удалось получить слот для персонажа ${characterName} при генерации`, 'Генерация');
            } else {
                // Управление счетчиком использования происходит здесь, в перехватчике генерации
                // Загружаем кеш только если персонаж НЕ был в слоте до вызова acquireSlot
                // Это означает, что персонаж только что получил слот (новый слот или вытеснение другого персонажа)
                const isNewSlot = !wasAlreadyInSlot;
                
                // Новый слот - загружаем кеш, если есть
                if (isNewSlot) {
                    try {
                        const cacheInfo = await getLastCacheForCharacter(characterName, true); // Только из текущего чата
                        
                        if (cacheInfo) {
                            const loaded = await loadSlotCache(currentSlot, cacheInfo.filename);
                            
                            if (loaded) {
                                // Форматируем дату-время из timestamp для тоста
                                const parsed = parseSaveFilename(cacheInfo.filename);
                                if (parsed && parsed.timestamp) {
                                    const dateTimeStr = formatTimestampToDate(parsed.timestamp);
                                    showToast('success', `Кеш для ${characterName} загружен (${dateTimeStr})`, 'Генерация');
                                } else {
                                    showToast('success', `Кеш для ${characterName} загружен`, 'Генерация');
                                }
                                console.debug(`[KV Cache Manager] Кеш персонажа ${characterName} успешно загружен в слот ${currentSlot} при генерации`);
                            } else {
                                showToast('warning', `Не удалось загрузить кеш для ${characterName}`, 'Генерация');
                                console.warn(`[KV Cache Manager] Не удалось загрузить кеш для персонажа ${characterName} в слот ${currentSlot}`);
                            }
                        } else {
                            console.debug(`[KV Cache Manager] Кеш для персонажа ${characterName} не найден, генерация продолжится с пустым кешем`);
                        }
                    } catch (e) {
                        console.error(`[KV Cache Manager] Ошибка при загрузке кеша для персонажа ${characterName}:`, e);
                        showToast('error', `Ошибка при загрузке кеша для ${characterName}: ${e.message}`, 'Генерация');
                        // Не прерываем генерацию при ошибке загрузки кеша
                    }
                }
                
                currentSlots[currentSlot].usage++;
                console.debug(`[KV Cache Manager] Счетчик использования для персонажа ${characterName} в слоте ${currentSlot} увеличен до: ${currentSlots[currentSlot].usage}`);
            }
            
            // Логируем завершение интерсептора для отладки
            const finalCharacterName = characterName || 'неизвестный';
            const finalSlot = currentSlot !== null ? currentSlot : 'неизвестный';
            showToast('info', `[KV Cache Manager] Интерсептор генерации завершен для персонажа ${finalCharacterName}, слот ${finalSlot}`, 'Генерация');
        } catch (error) {
            console.error('[KV Cache Manager] Ошибка в перехватчике генерации:', error);
            showToast('error', `Ошибка при перехвате генерации: ${error.message}`, 'Генерация');
        }
        
        // Финальное логирование - интерсептор полностью завершен
        showToast('info', `[KV Cache Manager] Интерсептор генерации полностью завершен, генерация может продолжиться`, 'Генерация');
    }
    
    // Регистрируем функцию-перехватчик в глобальном объекте
    window['KVCacheManagerInterceptor'] = KVCacheManagerInterceptor;
    
    // Подписка на событие получения сообщения для автосохранения
    eventSource.on(event_types.MESSAGE_RECEIVED, async (data) => {
        // Определяем персонажа из данных сообщения
        const characterName = data?.char || data?.name || null;
        await incrementMessageCounter(characterName);
    });
    
    // Подписка на событие переключения чата для автозагрузки
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        const currentChatId = getNormalizedChatId();
        
        // Если включена очистка слотов при переключении чата
        if (extensionSettings.clearSlotsOnChatSwitch) {
            // Очищаем все слоты перед переключением
            await clearAllSlots();
            // Не запоминаем последний загруженный чат, так как кеш будет очищен
            lastLoadedChatId = null;
        }
        
        // Если включен режим групповых чатов, распределяем персонажей по слотам
        // Кеш загружается автоматически в assignCharactersToSlots для персонажей в слотах
        if (extensionSettings.groupChatMode) {
            await assignCharactersToSlots();
        } else {
            // В обычном режиме проверяем автозагрузку
            if (extensionSettings.autoLoadOnChatSwitch) {
                setTimeout(async () => {
                    await tryAutoLoadOnChatSwitch(currentChatId);
                }, 500);
            }
        }
        
    });
    
    // При переключении чата счетчик не сбрасывается - каждый чат имеет свой независимый счетчик
    // Счетчик автоматически создается при первом сообщении в новом чате

    // Настраиваем обработчики событий
    $("#kv-cache-auto-load-ask").on("input", onAutoLoadAskConfirmationChange);
    $("#kv-cache-enabled").on("input", onEnabledChange);
    $("#kv-cache-save-interval").on("input", onSaveIntervalChange);
    $("#kv-cache-max-files").on("input", onMaxFilesChange);
    $("#kv-cache-auto-load").on("input", onAutoLoadChange);
    $("#kv-cache-show-notifications").on("input", onShowNotificationsChange);
    $("#kv-cache-validate").on("input", onValidateChange);
    $("#kv-cache-clear-slots").on("input", onClearSlotsChange);
    $("#kv-cache-group-chat-mode").on("input", onGroupChatModeChange);
    
    $("#kv-cache-save-button").on("click", onSaveButtonClick);
    $("#kv-cache-load-button").on("click", onLoadButtonClick);
    $("#kv-cache-save-now-button").on("click", onSaveNowButtonClick);
    $("#kv-cache-preload-characters-button").on("click", onPreloadCharactersButtonClick);
    $("#kv-cache-release-all-slots-button").on("click", onReleaseAllSlotsButtonClick);
    
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
        loadModalData.searchQuery = $(this).val();
        renderLoadModalChats();
        const activeChat = $(".kv-cache-load-chat-item.active");
        const activeCurrentChat = $(".kv-cache-load-chat-item-current.active");
        
        let currentChatId = null;
        if (activeChat.length) {
            currentChatId = activeChat.data('chat-id');
        } else if (activeCurrentChat.length) {
            currentChatId = loadModalData.currentChatId;
        }
        
        if (currentChatId) {
            // Обновляем выбранный чат при поиске
            loadModalData.selectedChatId = currentChatId;
            renderLoadModalFiles(currentChatId);
        }
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
        if (e.key === "Escape" && $("#kv-cache-auto-load-confirm-modal").is(":visible")) {
            closeAutoLoadConfirmModal();
        }
    });
    
    // Обработчики для модалки подтверждения автозагрузки
    $(document).on("click", "#kv-cache-auto-load-confirm-modal-close", closeAutoLoadConfirmModal);
    $(document).on("click", "#kv-cache-auto-load-confirm-cancel", closeAutoLoadConfirmModal);
    $(document).on("click", "#kv-cache-auto-load-confirm-ok", confirmAutoLoad);
    
    // Закрытие модалки подтверждения по клику вне её области
    $(document).on("click", "#kv-cache-auto-load-confirm-modal", function(e) {
        if ($(e.target).is("#kv-cache-auto-load-confirm-modal")) {
            closeAutoLoadConfirmModal();
        }
    });
});
