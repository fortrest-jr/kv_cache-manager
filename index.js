// KV Cache Manager для SillyTavern
// Расширение для управления KV-кешем llama.cpp
// Этап 2: Обычное сохранение и загрузка кеша по кнопке

// Импортируем необходимые функции
import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

// Имя расширения должно совпадать с именем папки
const extensionName = "SillyTavern-llamacpp-kv_cache-manager";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];

const defaultSettings = {
    enabled: true,
    saveInterval: 5,
    autoLoadOnChatSwitch: true,
    maxFiles: 10,
    showNotifications: true,
    validateCache: true,
    apiUrl: 'http://127.0.0.1:8080'
};

// Управление слотами (встроенная логика вместо зависимости от slot-manager)
const slotManagement = {
    slots: [],      // Массив: индекс = номер слота, значение = имя персонажа
    slotsUsage: []  // Массив: индекс = номер слота, значение = Date последнего использования
};

// Загрузка настроек
async function loadSettings() {
    // Создаем настройки, если их нет
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }

    // Обновляем настройки в UI
    const settings = extension_settings[extensionName];
    $("#kv-cache-enabled").prop("checked", settings.enabled).trigger("input");
    $("#kv-cache-save-interval").val(settings.saveInterval).trigger("input");
    $("#kv-cache-max-files").val(settings.maxFiles).trigger("input");
    $("#kv-cache-auto-load").prop("checked", settings.autoLoadOnChatSwitch).trigger("input");
    $("#kv-cache-show-notifications").prop("checked", settings.showNotifications).trigger("input");
    $("#kv-cache-validate").prop("checked", settings.validateCache).trigger("input");
    $("#kv-cache-api-url").val(settings.apiUrl || defaultSettings.apiUrl).trigger("input");
    
    // Загружаем управление слотами из настроек
    if (settings.slotManagement) {
        slotManagement.slots = settings.slotManagement.slots || [];
        slotManagement.slotsUsage = (settings.slotManagement.slotsUsage || []).map(d => d ? new Date(d) : null);
    }
}

// Показ toast-уведомления
function showToast(type, message, title = 'KV Cache Manager') {
    if (typeof toastr === 'undefined') {
        console.log(`[KV Cache Manager] ${title}: ${message}`);
        return;
    }

    const settings = extension_settings[extensionName] || defaultSettings;
    if (!settings.showNotifications) {
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
    extension_settings[extensionName].enabled = value;
    saveSettingsDebounced();
    showToast('success', `Автосохранение ${value ? 'включено' : 'отключено'}`);
}

function onSaveIntervalChange(event) {
    const value = parseInt($(event.target).val()) || 5;
    extension_settings[extensionName].saveInterval = value;
    saveSettingsDebounced();
    showToast('info', `Интервал сохранения установлен: ${value} сообщений`);
}

function onMaxFilesChange(event) {
    const value = parseInt($(event.target).val()) || 10;
    extension_settings[extensionName].maxFiles = value;
    saveSettingsDebounced();
    showToast('info', `Максимум файлов установлен: ${value}`);
}

function onAutoLoadChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].autoLoadOnChatSwitch = value;
    saveSettingsDebounced();
    showToast('success', `Автозагрузка ${value ? 'включена' : 'отключена'}`);
}

function onShowNotificationsChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].showNotifications = value;
    saveSettingsDebounced();
    showToast('success', `Уведомления ${value ? 'включены' : 'отключены'}`);
}

function onValidateChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].validateCache = value;
    saveSettingsDebounced();
    showToast('success', `Проверка валидности ${value ? 'включена' : 'отключена'}`);
}

function onApiUrlChange(event) {
    const value = $(event.target).val().trim() || defaultSettings.apiUrl;
    extension_settings[extensionName].apiUrl = value;
    saveSettingsDebounced();
    showToast('info', `URL API установлен: ${value}`);
    // Обновляем список слотов после изменения URL
    setTimeout(() => updateSlotsList(), 500);
}

// Получение URL llama.cpp сервера
function getLlamaUrl() {
    const settings = extension_settings[extensionName] || defaultSettings;
    return settings.apiUrl || defaultSettings.apiUrl;
}

// Получение имени текущего чата
function getCurrentChatName() {
    const context = getContext();
    if (context.chat && context.chat.name) {
        return context.chat.name;
    }
    if (context.chat && context.chat.title) {
        return context.chat.title;
    }
    return 'chat';
}

// Получение имени текущего персонажа
function getCurrentCharacterName() {
    const context = getContext();
    if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
        return context.characters[context.characterId].name;
    }
    // Для групповых чатов или если персонаж не выбран
    return null;
}

// Инициализация слотов
function initializeSlots(totalSlots) {
    if (!slotManagement.slots || slotManagement.slots.length !== totalSlots) {
        slotManagement.slots = new Array(totalSlots);
        slotManagement.slotsUsage = new Array(totalSlots);
    }
    console.debug(`[KV Cache Manager] Инициализировано ${totalSlots} слотов`);
}

// Получение номера слота по имени персонажа
function getSlotByCharacterName(characterName) {
    if (!characterName || !slotManagement.slots) {
        return null;
    }
    const slotIndex = slotManagement.slots.findIndex(key => key === characterName);
    return slotIndex !== -1 ? slotIndex : null;
}

// Получение слота для персонажа (создает новый или возвращает существующий)
function acquireSlot(characterName) {
    if (!characterName) {
        return null;
    }
    
    // Проверяем, есть ли уже слот для этого персонажа
    const existingIndex = slotManagement.slots.findIndex(key => key === characterName);
    if (existingIndex !== -1) {
        slotManagement.slotsUsage[existingIndex] = new Date();
        saveSlotManagement();
        return existingIndex;
    }
    
    // Ищем свободный слот
    const firstAvailableIndex = slotManagement.slots.findIndex(key => key === undefined || key === null);
    if (firstAvailableIndex !== -1) {
        slotManagement.slots[firstAvailableIndex] = characterName;
        slotManagement.slotsUsage[firstAvailableIndex] = new Date();
        saveSlotManagement();
        return firstAvailableIndex;
    }
    
    // Если нет свободных слотов, используем наименее используемый
    let leastRecentDate = Infinity;
    let leastRecentIndex = -1;
    
    slotManagement.slotsUsage.forEach((date, index) => {
        if (date && date < leastRecentDate) {
            leastRecentDate = date;
            leastRecentIndex = index;
        }
    });
    
    if (leastRecentIndex !== -1) {
        slotManagement.slots[leastRecentIndex] = characterName;
        slotManagement.slotsUsage[leastRecentIndex] = new Date();
        saveSlotManagement();
        return leastRecentIndex;
    }
    
    return null;
}

// Получение всех активных слотов с именами персонажей
function getActiveSlotsWithCharacters() {
    const result = [];
    if (!slotManagement.slots) {
        return result;
    }
    
    slotManagement.slots.forEach((characterName, slotIndex) => {
        if (typeof characterName === 'string' && characterName) {
            result.push({
                slotId: slotIndex,
                characterName: characterName
            });
        }
    });
    
    return result;
}

// Определение количества слотов через API
async function detectSlotsCount() {
    const llamaUrl = getLlamaUrl();
    
    try {
        // Пробуем получить через /slots
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${llamaUrl}/slots`, {
            method: 'GET',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const data = await response.json();
            
            if (Array.isArray(data)) {
                return data.length;
            } else if (typeof data === 'object') {
                // Если это объект, считаем количество ключей
                const keys = Object.keys(data);
                return keys.length;
            }
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.debug('[KV Cache Manager] Ошибка определения количества слотов через /slots:', e);
        }
    }
    
    // Fallback: пробуем перебрать слоты до 32
    for (let i = 0; i < 32; i++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            
            const response = await fetch(`${llamaUrl}/slots/${i}`, {
                method: 'GET',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok && response.status === 404) {
                // Если слот не существует, возвращаем предыдущий индекс + 1
                return i;
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                // Если ошибка не таймаут, возможно это последний слот
                return i;
            }
        }
    }
    
    // Если ничего не получилось, возвращаем дефолтное значение
    return 2;
}

// Сохранение управления слотами в настройках
function saveSlotManagement() {
    extension_settings[extensionName].slotManagement = {
        slots: slotManagement.slots || [],
        slotsUsage: (slotManagement.slotsUsage || []).map(d => d ? d.toISOString() : null)
    };
    saveSettingsDebounced();
}

// Получение ID текущего чата
function getCurrentChatId() {
    const context = getContext();
    if (context.chat && context.chat.id) {
        return String(context.chat.id);
    }
    return 'default';
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

// Генерация имени файла для автосохранения
function generateAutoSaveFilename(characterName) {
    const chatName = getCurrentChatName().replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeCharacterName = characterName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = formatTimestamp();
    return `${chatName}_${safeCharacterName}_${timestamp}.bin`;
}

// Генерация имени файла для ручного сохранения
function generateManualSaveFilename(userName, characterName) {
    const chatName = getCurrentChatName().replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeUserName = userName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeCharacterName = characterName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = formatTimestamp();
    return `${safeUserName}_${chatName}_${safeCharacterName}_${timestamp}.bin`;
}

// Проверка валидности слота (есть ли в нем данные)
async function isSlotValid(slotId) {
    const settings = extension_settings[extensionName] || defaultSettings;
    if (!settings.validateCache) {
        return true; // Если проверка отключена, считаем валидным
    }
    
    const llamaUrl = getLlamaUrl();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут
        
        const response = await fetch(`${llamaUrl}/slots/${slotId}`, {
            method: 'GET',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const slotInfo = await response.json();
            const nCtxUsed = slotInfo.n_ctx_used || 0;
            const nPromptTokens = slotInfo.n_prompt_tokens || 0;
            return nCtxUsed > 0 || nPromptTokens > 0;
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.debug(`[KV Cache Manager] Ошибка проверки слота ${slotId}:`, e);
        }
    }
    
    return false;
}

// Получение всех активных слотов с проверкой валидности
async function getActiveSlots() {
    // Получаем слоты из нашего управления
    const slotsWithCharacters = getActiveSlotsWithCharacters();
    
    if (slotsWithCharacters.length === 0) {
        console.debug('[KV Cache Manager] Нет активных слотов');
        return [];
    }
    
    // Проверяем валидность каждого слота
    const validSlots = [];
    for (const { slotId, characterName } of slotsWithCharacters) {
        if (await isSlotValid(slotId)) {
            validSlots.push({ slotId, characterName });
        }
    }
    
    return validSlots;
}

// Обновление списка слотов в UI
async function updateSlotsList() {
    const slotsListElement = $("#kv-cache-slots-list");
    if (slotsListElement.length === 0) {
        return;
    }
    
    try {
        // Инициализируем слоты, если нужно
        if (!slotManagement.slots || slotManagement.slots.length === 0) {
            const slotsCount = await detectSlotsCount();
            initializeSlots(slotsCount);
        }
        
        // Получаем слоты без проверки валидности (быстрее)
        const slotsWithCharacters = getActiveSlotsWithCharacters();
        
        if (slotsWithCharacters.length === 0) {
            slotsListElement.html('<p style="color: var(--SmartThemeBodyColor, inherit);">Нет активных слотов. Слоты будут распределены автоматически при сохранении.</p>');
            return;
        }
        
        // Показываем список слотов
        let html = '<ul style="margin: 5px 0; padding-left: 20px;">';
        for (const { slotId, characterName } of slotsWithCharacters) {
            html += `<li style="margin: 3px 0;">Слот ${slotId}: <strong>${characterName}</strong></li>`;
        }
        html += '</ul>';
        html += `<p style="margin-top: 5px; font-size: 0.9em; color: var(--SmartThemeBodyColor, inherit);">Всего: ${slotsWithCharacters.length} слот(ов)</p>`;
        html += `<p style="margin-top: 3px; font-size: 0.85em; color: var(--SmartThemeBodyColor, inherit); opacity: 0.7;">При сохранении будут проверены только слоты с валидным кешем</p>`;
        
        slotsListElement.html(html);
    } catch (e) {
        console.error('[KV Cache Manager] Ошибка при обновлении списка слотов:', e);
        const errorMessage = e.message || 'Неизвестная ошибка';
        slotsListElement.html(`<p style="color: var(--SmartThemeBodyColor, inherit);">Ошибка загрузки слотов: ${errorMessage}</p>`);
    }
}

// Сохранение кеша для слота
async function saveSlotCache(slotId, filename) {
    const llamaUrl = getLlamaUrl();
    const url = `${llamaUrl}/slots/${slotId}?action=save`;
    const requestBody = { filename: filename };
    
    console.log(`[KV Cache Manager] Сохранение кеша: URL=${url}, filename=${filename}`);
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 минут таймаут
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        console.log(`[KV Cache Manager] Ответ сервера: status=${response.status}, ok=${response.ok}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[KV Cache Manager] Ошибка сохранения слота ${slotId}: ${response.status} ${errorText}`);
            return false;
        }
        
        console.log(`[KV Cache Manager] Кеш успешно сохранен для слота ${slotId}`);
        return true;
    } catch (e) {
        if (e.name === 'AbortError') {
            console.error(`[KV Cache Manager] Таймаут при сохранении кеша слота ${slotId}`);
        } else {
            console.error(`[KV Cache Manager] Ошибка сохранения слота ${slotId}:`, e);
        }
        return false;
    }
}

// Загрузка кеша для слота
async function loadSlotCache(slotId, filename) {
    const llamaUrl = getLlamaUrl();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 минут таймаут
        
        const response = await fetch(`${llamaUrl}/slots/${slotId}?action=restore`, {
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

// Проверка доступности llama.cpp сервера
async function checkServerAvailability() {
    const llamaUrl = getLlamaUrl();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 секунд таймаут
        
        const response = await fetch(`${llamaUrl}/health`, {
            method: 'GET',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        return response.ok;
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.debug('[KV Cache Manager] Сервер недоступен:', e);
        }
        return false;
    }
}

// Обработчики для кнопок
async function onSaveButtonClick() {
    const userName = prompt('Введите имя для сохранения:');
    if (!userName || !userName.trim()) {
        if (userName !== null) {
            // Пользователь нажал OK, но не ввел имя
            showToast('error', 'Имя не может быть пустым');
        }
        return;
    }
    
    showToast('info', 'Начинаю сохранение кеша...');
    
    // Проверка доступности сервера
    const isServerAvailable = await checkServerAvailability();
    if (!isServerAvailable) {
        showToast('error', 'Сервер llama.cpp недоступен');
        return;
    }
    
    // Инициализируем слоты, если нужно
    if (!slotManagement.slots || slotManagement.slots.length === 0) {
        const slotsCount = await detectSlotsCount();
        initializeSlots(slotsCount);
    }
    
    // Получаем имена персонажей из текущего чата
    const context = getContext();
    const characterNames = [];
    
    // Для обычного чата - один персонаж
    if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
        characterNames.push(context.characters[context.characterId].name);
    }
    
    // Для группового чата - все персонажи из группы
    if (context.groupId && context.groups) {
        const group = context.groups.find(g => g.id === context.groupId);
        if (group && group.characters) {
            group.characters.forEach(charId => {
                const char = context.characters.find(c => c.id === charId);
                if (char && !characterNames.includes(char.name)) {
                    characterNames.push(char.name);
                }
            });
        }
    }
    
    // Проверяем все слоты на валидность и используем уже распределенные слоты
    const validSlots = [];
    for (let slotId = 0; slotId < slotManagement.slots.length; slotId++) {
        if (await isSlotValid(slotId)) {
            // Используем имя персонажа из распределения слотов
            let characterName = slotManagement.slots[slotId];
            
            // Если слот не распределен, используем первого персонажа из чата как fallback
            if (!characterName && characterNames.length > 0) {
                characterName = characterNames[0];
            }
            
            // Если все еще нет имени, используем общее
            if (!characterName) {
                characterName = getCurrentCharacterName() || 'character';
            }
            
            validSlots.push({ slotId, characterName });
        }
    }
    
    if (validSlots.length === 0) {
        showToast('warning', 'Нет активных слотов с валидным кешем для сохранения');
        return;
    }
    
    const slots = validSlots;
    
    showToast('info', `Найдено ${slots.length} активных слотов`);
    
    let savedCount = 0;
    let errors = [];
    
    for (const { slotId, characterName } of slots) {
        try {
            const filename = generateManualSaveFilename(userName.trim(), characterName);
            if (await saveSlotCache(slotId, filename)) {
                savedCount++;
                console.log(`[KV Cache Manager] Сохранен кеш для слота ${slotId} (${characterName}): ${filename}`);
            } else {
                errors.push(`${characterName} (слот ${slotId})`);
            }
        } catch (e) {
            console.error(`[KV Cache Manager] Ошибка при сохранении слота ${slotId} (${characterName}):`, e);
            errors.push(`${characterName} (слот ${slotId}): ${e.message}`);
        }
    }
    
    if (savedCount > 0) {
        if (errors.length > 0) {
            showToast('warning', `Сохранено ${savedCount} из ${slots.length} слотов с именем "${userName}". Ошибки: ${errors.join(', ')}`);
        } else {
            showToast('success', `Сохранено ${savedCount} из ${slots.length} слотов с именем "${userName}"`);
        }
        // Обновляем список слотов после сохранения
        setTimeout(() => updateSlotsList(), 1000);
    } else {
        showToast('error', `Не удалось сохранить кеш. Ошибки: ${errors.join(', ')}`);
    }
}

async function onLoadButtonClick() {
    showToast('info', 'Функция загрузки кеша будет реализована на следующем этапе');
    // TODO: Реализовать загрузку кеша
}

async function onSaveNowButtonClick() {
    showToast('info', 'Начинаю сохранение кеша...');
    
    // Проверка доступности сервера
    const isServerAvailable = await checkServerAvailability();
    if (!isServerAvailable) {
        showToast('error', 'Сервер llama.cpp недоступен');
        return;
    }
    
    // Инициализируем слоты, если нужно
    if (!slotManagement.slots || slotManagement.slots.length === 0) {
        const slotsCount = await detectSlotsCount();
        initializeSlots(slotsCount);
    }
    
    // Получаем имена персонажей из текущего чата
    const context = getContext();
    const characterNames = [];
    
    // Для обычного чата - один персонаж
    if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
        characterNames.push(context.characters[context.characterId].name);
    }
    
    // Для группового чата - все персонажи из группы
    if (context.groupId && context.groups) {
        const group = context.groups.find(g => g.id === context.groupId);
        if (group && group.characters) {
            group.characters.forEach(charId => {
                const char = context.characters.find(c => c.id === charId);
                if (char && !characterNames.includes(char.name)) {
                    characterNames.push(char.name);
                }
            });
        }
    }
    
    // Проверяем все слоты на валидность и используем уже распределенные слоты
    const validSlots = [];
    for (let slotId = 0; slotId < slotManagement.slots.length; slotId++) {
        if (await isSlotValid(slotId)) {
            // Используем имя персонажа из распределения слотов
            let characterName = slotManagement.slots[slotId];
            
            // Если слот не распределен, используем первого персонажа из чата как fallback
            if (!characterName && characterNames.length > 0) {
                characterName = characterNames[0];
            }
            
            // Если все еще нет имени, используем общее
            if (!characterName) {
                characterName = getCurrentCharacterName() || 'character';
            }
            
            validSlots.push({ slotId, characterName });
        }
    }
    
    if (validSlots.length === 0) {
        showToast('warning', 'Нет активных слотов с валидным кешем для сохранения');
        return;
    }
    
    const slots = validSlots;
    
    showToast('info', `Найдено ${slots.length} активных слотов`);
    
    let savedCount = 0;
    let errors = [];
    
    for (const { slotId, characterName } of slots) {
        try {
            const filename = generateAutoSaveFilename(characterName);
            if (await saveSlotCache(slotId, filename)) {
                savedCount++;
                console.log(`[KV Cache Manager] Сохранен кеш для слота ${slotId} (${characterName}): ${filename}`);
            } else {
                errors.push(`${characterName} (слот ${slotId})`);
            }
        } catch (e) {
            console.error(`[KV Cache Manager] Ошибка при сохранении слота ${slotId} (${characterName}):`, e);
            errors.push(`${characterName} (слот ${slotId}): ${e.message}`);
        }
    }
    
    if (savedCount > 0) {
        if (errors.length > 0) {
            showToast('warning', `Сохранено ${savedCount} из ${slots.length} слотов. Ошибки: ${errors.join(', ')}`);
        } else {
            showToast('success', `Сохранено ${savedCount} слотов`);
        }
        // Обновляем список слотов после сохранения
        setTimeout(() => updateSlotsList(), 1000);
    } else {
        showToast('error', `Не удалось сохранить кеш. Ошибки: ${errors.join(', ')}`);
    }
}

// Обработчик события генерации - распределяем слоты при начале генерации
let currentSlot = null;

// Функция вызывается при загрузке расширения
jQuery(async () => {
    // Загружаем HTML из файла
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);

    // Добавляем HTML в контейнер настроек
    $("#extensions_settings").append(settingsHtml);

    // Настраиваем обработчики событий
    $("#kv-cache-enabled").on("input", onEnabledChange);
    $("#kv-cache-save-interval").on("input", onSaveIntervalChange);
    $("#kv-cache-max-files").on("input", onMaxFilesChange);
    $("#kv-cache-auto-load").on("input", onAutoLoadChange);
    $("#kv-cache-show-notifications").on("input", onShowNotificationsChange);
    $("#kv-cache-validate").on("input", onValidateChange);
    $("#kv-cache-api-url").on("input", onApiUrlChange);
    
    $("#kv-cache-save-button").on("click", onSaveButtonClick);
    $("#kv-cache-load-button").on("click", onLoadButtonClick);
    $("#kv-cache-save-now-button").on("click", onSaveNowButtonClick);

    // Загружаем настройки при старте
    loadSettings();
    
    // Инициализируем слоты при старте приложения
    eventSource.on(event_types.APP_READY, async () => {
        if (!slotManagement.slots || slotManagement.slots.length === 0) {
            const slotsCount = await detectSlotsCount();
            initializeSlots(slotsCount);
        }
    });
    
    // Распределяем слоты при начале генерации (как в slot-manager)
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (data) => {
        if (data && data.char) {
            // Инициализируем слоты, если нужно
            if (!slotManagement.slots || slotManagement.slots.length === 0) {
                // Используем дефолтное значение, если не удалось определить
                initializeSlots(2);
            }
            
            // Распределяем слот для персонажа
            currentSlot = acquireSlot(data.char);
            console.debug(`[KV Cache Manager] Распределен слот ${currentSlot} для персонажа ${data.char}`);
        }
    });
    
    // Обновляем список слотов при старте
    updateSlotsList();
    
    // Обновляем список слотов периодически (каждые 5 секунд)
    setInterval(() => {
        updateSlotsList();
    }, 5000);
    
    // Обновляем список слотов при клике на кнопки сохранения
    $("#kv-cache-save-button, #kv-cache-save-now-button").on("click", () => {
        setTimeout(() => updateSlotsList(), 1000);
    });
});
