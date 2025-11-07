// KV Cache Manager для SillyTavern
// Расширение для управления KV-кешем llama.cpp
// Этап 2: Обычное сохранение и загрузка кеша по кнопке

// Импортируем необходимые функции
import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { textgen_types, textgenerationwebui_settings } from '../../../textgen-settings.js';

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
    apiUrl: 'http://127.0.0.1:8080',
    saves: [] // Список сохранений: [{ timestamp, chatName, userName, files: [{ filename, slotId }] }]
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
    const provided_url = textgenerationwebui_settings.server_urls[textgen_types.LLAMACPP]
    showToast('warning', 'provided_url: ' + provided_url);
    return provided_url || settings.apiUrl || defaultSettings.apiUrl;
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
    // Если имя чата не найдено, используем ID чата
    if (context.chat && context.chat.id) {
        return `chat_${context.chat.id}`;
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

// Получение количества слотов из ответа /slots
function getSlotsCountFromData(slotsData) {
    if (Array.isArray(slotsData)) {
        return slotsData.length;
    } else if (typeof slotsData === 'object' && slotsData !== null) {
        return Object.keys(slotsData).length;
    }
    return 0;
}

// Определение количества слотов через API (для обратной совместимости, если проверка отключена)
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
function generateAutoSaveFilename(slotId) {
    const chatName = getCurrentChatName().replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = formatTimestamp();
    return `${chatName}_${timestamp}_slot${slotId}.bin`;
}

// Генерация имени файла для ручного сохранения
function generateManualSaveFilename(userName, slotId) {
    const chatName = getCurrentChatName().replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeUserName = userName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = formatTimestamp();
    return `${safeUserName}_${chatName}_${timestamp}_slot${slotId}.bin`;
}

// Получение информации о всех слотах через /slots
async function getAllSlotsInfo() {
    const llamaUrl = getLlamaUrl();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут
        
        const response = await fetch(`${llamaUrl}/slots`, {
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
        }
    }
    
    return null;
}

// Проверка валидности слота (есть ли в нем данные)
function isSlotValid(slotInfo) {
    if (!slotInfo || typeof slotInfo !== 'object') {
        return false;
    }
    
    // Слот использован, если есть параметр id_task
    return 'id_task' in slotInfo && slotInfo.id_task != null;
}

// Получение всех активных слотов с проверкой валидности
async function getActiveSlots() {
    const settings = extension_settings[extensionName] || defaultSettings;
    
    // Получаем информацию о всех слотах через /slots
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
    if (!settings.validateCache) {
        return Array.from({ length: slotsArray.length }, (_, i) => i);
    }
    
    // Фильтруем валидные слоты
    const validSlots = [];
    slotsArray.forEach((slotInfo, index) => {
        if (isSlotValid(slotInfo)) {
            validSlots.push(index);
        }
    });
    
    return validSlots;
}

// Обновление списка слотов в UI
async function updateSlotsList() {
    const slotsListElement = $("#kv-cache-slots-list");
    if (slotsListElement.length === 0) {
        return;
    }
    
    try {
        // Получаем информацию о слотах для определения общего количества
        const slotsData = await getAllSlotsInfo();
        const totalSlots = slotsData ? getSlotsCountFromData(slotsData) : 0;
        
        // Получаем валидные слоты
        const validSlots = await getActiveSlots();
        
        if (validSlots.length === 0) {
            slotsListElement.html('<p style="color: var(--SmartThemeBodyColor, inherit);">Нет активных слотов с валидным кешем</p>');
            return;
        }
        
        // Показываем список слотов
        let html = '<ul style="margin: 5px 0; padding-left: 20px;">';
        for (const slotId of validSlots) {
            html += `<li style="margin: 3px 0;">Слот <strong>${slotId}</strong></li>`;
        }
        html += '</ul>';
        html += `<p style="margin-top: 5px; font-size: 0.9em; color: var(--SmartThemeBodyColor, inherit);">Всего: ${validSlots.length} слот(ов) из ${totalSlots}</p>`;
        html += `<p style="margin-top: 3px; font-size: 0.85em; color: var(--SmartThemeBodyColor, inherit); opacity: 0.7;">Будут сохранены все валидные слоты</p>`;
        
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
        
        console.log(`[KV Cache Manager] Загрузка кеша: слот ${slotId}, файл ${filename}`);
        
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
        
        console.log(`[KV Cache Manager] Кеш успешно загружен для слота ${slotId}`);
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

// Парсинг имени файла для извлечения имени чата, timestamp и slotId
function parseCacheFilename(filename) {
    // Формат: {chat_name}_{timestamp}_slot{slotId}.bin
    // или: {user_name}_{chat_name}_{timestamp}_slot{slotId}.bin
    const match = filename.match(/^(.+?)_(\d{14})_slot(\d+)\.bin$/);
    if (match) {
        const fullPrefix = match[1];
        const timestamp = match[2];
        const slotId = parseInt(match[3], 10);
        
        // Разделяем префикс на части
        // Для ручных сохранений: user_chat, для автосохранений: chat
        const parts = fullPrefix.split('_');
        let chatName, userName = null;
        
        if (parts.length === 1) {
            // Просто имя чата
            chatName = parts[0];
        } else {
            // Возможно, это user_chat формат
            // Берем последнюю часть как имя чата, остальное - имя пользователя
            chatName = parts[parts.length - 1];
            userName = parts.slice(0, -1).join('_');
        }
        
        return {
            chatName: chatName,
            userName: userName,
            timestamp: timestamp,
            slotId: slotId,
            isValid: true
        };
    }
    return { isValid: false };
}

// Получение списка сохранений из настроек
function getSavesList() {
    const settings = extension_settings[extensionName] || defaultSettings;
    return settings.saves || [];
}

// Добавление сохранения в список
function addSaveToList(timestamp, chatName, userName, files) {
    const settings = extension_settings[extensionName] || defaultSettings;
    if (!settings.saves) {
        settings.saves = [];
    }
    
    // Добавляем сохранение в начало списка
    settings.saves.unshift({
        timestamp: timestamp,
        chatName: chatName,
        userName: userName || null,
        files: files.map(f => ({ filename: f.filename, slotId: f.slotId }))
    });
    
    // Ограничиваем количество сохранений (храним последние N)
    const maxSaves = 100; // Максимум сохранений в списке
    if (settings.saves.length > maxSaves) {
        settings.saves = settings.saves.slice(0, maxSaves);
    }
    
    saveSettingsDebounced();
}

// Удаление сохранения из списка
function removeSaveFromList(timestamp, chatName) {
    const settings = extension_settings[extensionName] || defaultSettings;
    if (!settings.saves) {
        return;
    }
    
    settings.saves = settings.saves.filter(save => 
        !(save.timestamp === timestamp && save.chatName === chatName)
    );
    
    saveSettingsDebounced();
}

// Группировка сохранений по имени чата и timestamp (из списка в настройках)
function groupSavesByChatAndTimestamp(saves) {
    const groups = {};
    
    for (const save of saves) {
        const key = `${save.chatName}_${save.timestamp}`;
        if (!groups[key]) {
            groups[key] = {
                chatName: save.chatName,
                userName: save.userName,
                timestamp: save.timestamp,
                files: []
            };
        }
        groups[key].files.push(...save.files);
    }
    
    return groups;
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
    
    // Получаем все валидные слоты
    const slots = await getActiveSlots();
    
    if (slots.length === 0) {
        showToast('warning', 'Нет активных слотов с валидным кешем для сохранения');
        return;
    }
    
    showToast('info', `Найдено ${slots.length} активных слотов`);
    console.log(`[KV Cache Manager] Начинаю сохранение ${slots.length} слотов с именем "${userName}":`, slots);
    
    let savedCount = 0;
    let errors = [];
    const timestamp = formatTimestamp();
    const chatName = getCurrentChatName();
    const savedFiles = [];
    
    for (const slotId of slots) {
        try {
            const filename = generateManualSaveFilename(userName.trim(), slotId);
            console.log(`[KV Cache Manager] Сохранение слота ${slotId} с именем файла: ${filename}`);
            if (await saveSlotCache(slotId, filename)) {
                savedCount++;
                savedFiles.push({ filename: filename, slotId: slotId });
                console.log(`[KV Cache Manager] Сохранен кеш для слота ${slotId}: ${filename}`);
            } else {
                errors.push(`слот ${slotId}`);
            }
        } catch (e) {
            console.error(`[KV Cache Manager] Ошибка при сохранении слота ${slotId}:`, e);
            errors.push(`слот ${slotId}: ${e.message}`);
        }
    }
    
    if (savedCount > 0) {
        // Добавляем сохранение в список
        addSaveToList(timestamp, chatName, userName.trim(), savedFiles);
        
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
    showToast('info', 'Начинаю загрузку кеша...');
    
    // Проверка доступности сервера
    const isServerAvailable = await checkServerAvailability();
    if (!isServerAvailable) {
        showToast('error', 'Сервер llama.cpp недоступен');
        return;
    }
    
    // Получаем список сохранений из настроек
    const savesList = getSavesList();
    
    if (!savesList || savesList.length === 0) {
        showToast('warning', 'Не найдено сохранений для загрузки. Сначала сохраните кеш.');
        return;
    }
    
    showToast('info', `Найдено сохранений: ${savesList.length}`);
    
    // Группируем сохранения по имени чата и timestamp
    const groups = groupSavesByChatAndTimestamp(savesList);
    const groupKeys = Object.keys(groups).sort().reverse(); // Сортируем по убыванию (новые первыми)
    
    if (groupKeys.length === 0) {
        showToast('warning', 'Не найдено сохранений для загрузки');
        return;
    }
    
    showToast('info', `Найдено групп сохранений: ${groupKeys.length}`);
    
    // Формируем список для выбора
    const options = groupKeys.map((key, index) => {
        const group = groups[key];
        const date = new Date(
            parseInt(group.timestamp.substring(0, 4)), // год
            parseInt(group.timestamp.substring(4, 6)) - 1, // месяц (0-based)
            parseInt(group.timestamp.substring(6, 8)), // день
            parseInt(group.timestamp.substring(8, 10)), // час
            parseInt(group.timestamp.substring(10, 12)), // минута
            parseInt(group.timestamp.substring(12, 14)) // секунда
        );
        // Форматируем дату и время
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
        const slotsCount = group.files.length;
        const chatName = group.chatName;
        return `${index + 1}. ${chatName} - ${dateStr} ${timeStr} (${slotsCount} слот${slotsCount !== 1 ? 'ов' : ''})`;
    }).join('\n');
    
    const choice = prompt(`Выберите сохранение для загрузки:\n\n${options}\n\nВведите номер (1-${groupKeys.length}):`);
    
    if (!choice || isNaN(choice)) {
        return;
    }
    
    const index = parseInt(choice, 10) - 1;
    if (index < 0 || index >= groupKeys.length) {
        showToast('error', 'Неверный номер');
        return;
    }
    
    const selectedGroup = groups[groupKeys[index]];
    const filesToLoad = selectedGroup.files.map(f => ({
        filename: f.filename,
        slotId: f.slotId
    }));
    
    if (filesToLoad.length === 0) {
        showToast('warning', 'Не найдено файлов для загрузки');
        return;
    }
    
    showToast('info', `Найдено ${filesToLoad.length} файлов для загрузки`);
    console.log(`[KV Cache Manager] Начинаю загрузку ${filesToLoad.length} файлов:`, filesToLoad);
    
    let loadedCount = 0;
    let errors = [];
    
    for (const { filename, slotId } of filesToLoad) {
        try {
            if (await loadSlotCache(slotId, filename)) {
                loadedCount++;
                console.log(`[KV Cache Manager] Загружен кеш для слота ${slotId} из файла ${filename}`);
            } else {
                errors.push(`слот ${slotId}`);
            }
        } catch (e) {
            console.error(`[KV Cache Manager] Ошибка при загрузке слота ${slotId}:`, e);
            errors.push(`слот ${slotId}: ${e.message}`);
        }
    }
    
    if (loadedCount > 0) {
        if (errors.length > 0) {
            showToast('warning', `Загружено ${loadedCount} из ${filesToLoad.length} слотов. Ошибки: ${errors.join(', ')}`);
        } else {
            showToast('success', `Загружено ${loadedCount} слотов`);
        }
        // Обновляем список слотов после загрузки
        setTimeout(() => updateSlotsList(), 1000);
    } else {
        showToast('error', `Не удалось загрузить кеш. Ошибки: ${errors.join(', ')}`);
    }
}

async function onSaveNowButtonClick() {
    showToast('info', 'Начинаю сохранение кеша...');
    
    // Проверка доступности сервера
    const isServerAvailable = await checkServerAvailability();
    if (!isServerAvailable) {
        showToast('error', 'Сервер llama.cpp недоступен');
        return;
    }
    
    // Получаем все валидные слоты
    const slots = await getActiveSlots();
    
    if (slots.length === 0) {
        showToast('warning', 'Нет активных слотов с валидным кешем для сохранения');
        return;
    }
    
    showToast('info', `Найдено ${slots.length} активных слотов`);
    console.log(`[KV Cache Manager] Начинаю сохранение ${slots.length} слотов:`, slots);
    
    let savedCount = 0;
    let errors = [];
    const timestamp = formatTimestamp();
    const chatName = getCurrentChatName();
    const savedFiles = [];
    
    for (const slotId of slots) {
        try {
            const filename = generateAutoSaveFilename(slotId);
            console.log(`[KV Cache Manager] Сохранение слота ${slotId} с именем файла: ${filename}`);
            if (await saveSlotCache(slotId, filename)) {
                savedCount++;
                savedFiles.push({ filename: filename, slotId: slotId });
                console.log(`[KV Cache Manager] Сохранен кеш для слота ${slotId}: ${filename}`);
            } else {
                errors.push(`слот ${slotId}`);
            }
        } catch (e) {
            console.error(`[KV Cache Manager] Ошибка при сохранении слота ${slotId}:`, e);
            errors.push(`слот ${slotId}: ${e.message}`);
        }
    }
    
    if (savedCount > 0) {
        // Добавляем сохранение в список (без имени пользователя для автосохранений)
        addSaveToList(timestamp, chatName, null, savedFiles);
        
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
    
    // Инициализация больше не нужна - количество слотов определяется из ответа API
    
    // Показываем placeholder для списка слотов (обновится при сохранении/загрузке)
    updateSlotsListPlaceholder();
    
    // Обновляем список слотов только при сохранении/загрузке
    $("#kv-cache-save-button, #kv-cache-save-now-button, #kv-cache-load-button").on("click", () => {
        setTimeout(() => updateSlotsList(), 1000);
    });
});
