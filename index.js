// KV Cache Manager для SillyTavern
// Расширение для управления KV-кешем llama.cpp

// Импортируем необходимые функции
import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, getCurrentChatId } from "../../../../script.js";
import { textgen_types, textgenerationwebui_settings } from '../../../textgen-settings.js';

// Имя расширения должно совпадать с именем папки
const extensionName = "kv_cache-manager";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const defaultSettings = {
    enabled: true,
    saveInterval: 5,
    autoLoadOnChatSwitch: true,
    maxFiles: 10,
    showNotifications: true,
    checkSlotUsage: true
};

const extensionSettings = extension_settings[extensionName] ||= {};


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
    $("#kv-cache-show-notifications").prop("checked", extensionSettings.showNotifications).trigger("input");
    $("#kv-cache-validate").prop("checked", extensionSettings.checkSlotUsage).trigger("input");
    
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
}

function onSaveIntervalChange(event) {
    const value = parseInt($(event.target).val()) || 5;
    extensionSettings.saveInterval = value;
    saveSettingsDebounced();
    showToast('info', `Интервал сохранения установлен: ${value} сообщений`);
}

function onMaxFilesChange(event) {
    const value = parseInt($(event.target).val()) || 10;
    extensionSettings.maxFiles = value;
    saveSettingsDebounced();
    showToast('info', `Максимум файлов установлен: ${value}`);
}

function onAutoLoadChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extensionSettings.autoLoadOnChatSwitch = value;
    saveSettingsDebounced();
    showToast('success', `Автозагрузка ${value ? 'включена' : 'отключена'}`);
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
    showToast('success', `Проверка использования слота ${value ? 'включена' : 'отключена'}`);
}

// Получение URL llama.cpp сервера
function getLlamaUrl() {
    const provided_url = textgenerationwebui_settings.server_urls[textgen_types.LLAMACPP]
    console.debug('Lllamacpp server URL: ' + provided_url);
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

// Генерация имени файла в едином формате
// Формат: {chatId}_{timestamp}_{named_}{userName}_slot{slotId}.bin
// Если userName указан, добавляется префикс "named_"
function generateSaveFilename(chatId, timestamp, slotId, userName = null) {
    const safeChatId = String(chatId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeSlotId = String(slotId);
    const safeUserFiller = userName ? `_named_${userName.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';

    return `${safeChatId}_${timestamp}${safeUserFiller}_slot${safeSlotId}.bin`;
}

// Парсинг имени файла для извлечения данных
// Возвращает { chatId, timestamp, userName, slotId } или null при ошибке
function parseSaveFilename(filename) {
    // Убираем расширение .bin
    const nameWithoutExt = filename.replace(/\.bin$/, '');
    
    // Парсим с конца: ищем _slot{число}
    const slotMatch = nameWithoutExt.match(/_slot(\d+)$/);
    if (!slotMatch) {
        return null;
    }
    
    const slotId = parseInt(slotMatch[1], 10);
    let beforeSlot = nameWithoutExt.slice(0, -slotMatch[0].length);
    
    // Проверяем наличие _named_{userName} перед _slot
    let userName = null;
    const namedMatch = beforeSlot.match(/_named_(.+)$/);
    if (namedMatch) {
        userName = namedMatch[1];
        beforeSlot = beforeSlot.slice(0, -namedMatch[0].length);
    }
    
    // Ищем timestamp (14 цифр) с конца
    const timestampMatch = beforeSlot.match(/_(\d{14})$/);
    if (!timestampMatch) {
        return null;
    }
    
    const timestamp = timestampMatch[1];
    const chatId = beforeSlot.slice(0, -timestampMatch[0].length);
    
    return {
        chatId: chatId,
        timestamp: timestamp,
        userName: userName,
        slotId: slotId
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
            showToast('error', 'Ошибка получения информации о слотах:', e);
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
    const url = `${llamaUrl}slots/${slotId}?action=save`;
    const requestBody = { filename: filename };
    
    console.debug(`[KV Cache Manager] Сохранение кеша: URL=${url}, filename=${filename}`);
    
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
        
        console.debug(`[KV Cache Manager] Ответ сервера: status=${response.status}, ok=${response.ok}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[KV Cache Manager] Ошибка сохранения слота ${slotId}: ${response.status} ${errorText}`);
            return false;
        }
        
        console.debug(`[KV Cache Manager] Кеш успешно сохранен для слота ${slotId}`);
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
        
        console.debug(`[KV Cache Manager] Кеш успешно загружен для слота ${slotId}`);
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
// Возвращает объект: { [chatId]: [{ timestamp, userName, files }, ...] }
function groupFilesByChat(files) {
    const chats = {};
    
    for (const file of files) {
        const filename = file.name || file;
        const parsed = parseSaveFilename(filename);
        
        if (!parsed) {
            // Если не удалось распарсить, пропускаем этот файл
            console.warn('[KV Cache Manager] Не удалось распарсить имя файла:', filename);
            continue;
        }
        
        const chatId = parsed.chatId;
        if (!chats[chatId]) {
            chats[chatId] = [];
        }
        
        // Ищем существующую группу с таким timestamp в этом чате
        let group = chats[chatId].find(g => g.timestamp === parsed.timestamp);
        if (!group) {
            group = {
                chatId: chatId,
                timestamp: parsed.timestamp,
                userName: parsed.userName || null,
                files: []
            };
            chats[chatId].push(group);
        }
        
        // Сохраняем объект файла с именем и размером
        group.files.push({
            name: filename,
            size: file.size || 0,
            slotId: parsed.slotId
        });
    }
    
    // Сортируем файлы внутри каждого чата от новых к старым (по timestamp)
    for (const chatId in chats) {
        chats[chatId].sort((a, b) => {
            // Сравниваем timestamp как строки (они в формате YYYYMMDDHHMMSS)
            return b.timestamp.localeCompare(a.timestamp);
        });
    }
    
    return chats;
}

// Общая функция сохранения кеша
async function saveCache(requestUserName = false) {
    let userName = null;
    
    // Запрашиваем имя пользователя, если нужно
    if (requestUserName) {
        userName = prompt('Введите имя для сохранения:');
        if (!userName || !userName.trim()) {
            if (userName !== null) {
                // Пользователь нажал OK, но не ввел имя
                showToast('error', 'Имя не может быть пустым');
            }
            return;
        }
        userName = userName.trim();
    }
    
    // Получаем ID чата или используем дефолтное значение
    const chatId = getCurrentChatId() || 'unknown';
    
    showToast('info', 'Начинаю сохранение кеша...');
    
    // Получаем все валидные слоты
    const slots = await getActiveSlots();
    
    if (slots.length === 0) {
        showToast('warning', 'Нет активных слотов с валидным кешем для сохранения');
        return;
    }
    
    showToast('info', `Найдено ${slots.length} активных слотов`);
    console.debug(`[KV Cache Manager] Начинаю сохранение ${slots.length} слотов:`, slots);
    
    // Генерируем timestamp один раз для всех слотов в этом сохранении
    const timestamp = formatTimestamp();
    
    let savedCount = 0;
    let errors = [];
    
    for (const slotId of slots) {
        try {
            const filename = generateSaveFilename(chatId, timestamp, slotId, userName);
            console.debug(`[KV Cache Manager] Сохранение слота ${slotId} с именем файла: ${filename}`);
            if (await saveSlotCache(slotId, filename)) {
                savedCount++;
                console.debug(`[KV Cache Manager] Сохранен кеш для слота ${slotId}: ${filename}`);
            } else {
                errors.push(`слот ${slotId}`);
            }
        } catch (e) {
            console.error(`[KV Cache Manager] Ошибка при сохранении слота ${slotId}:`, e);
            errors.push(`слот ${slotId}: ${e.message}`);
        }
    }
    
    if (savedCount > 0) {
        // Формируем сообщение об успехе
        if (errors.length > 0) {
            showToast('warning', `Сохранено ${savedCount} из ${slots.length} слотов. Ошибки: ${errors.join(', ')}`);
        } else {
            showToast('success', `Сохранено ${savedCount} из ${slots.length} слотов`);
        }
        // Обновляем список слотов после сохранения
        setTimeout(() => updateSlotsList(), 1000);
    } else {
        showToast('error', `Не удалось сохранить кеш. Ошибки: ${errors.join(', ')}`);
    }
}

// Обработчики для кнопок
async function onSaveButtonClick() {
    await saveCache(true); // Запрашиваем имя пользователя
}

async function onSaveNowButtonClick() {
    await saveCache(false); // Не запрашиваем имя пользователя
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

// Глобальные переменные для модалки загрузки
let loadModalData = {
    chats: {},
    currentChatId: null,
    selectedGroup: null,
    searchQuery: ''
};

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
    
    // Группируем файлы по чатам
    loadModalData.chats = groupFilesByChat(filesList);
    
    if (Object.keys(loadModalData.chats).length === 0) {
        $("#kv-cache-load-files-list").html('<div class="kv-cache-load-empty">Не найдено сохранений для загрузки</div>');
        showToast('warning', 'Не найдено сохранений для загрузки');
        return;
    }
    
    // Получаем текущий chatId
    loadModalData.currentChatId = getCurrentChatId() || 'unknown';
    
    // Отображаем чаты и файлы
    renderLoadModalChats();
    selectLoadModalChat('current');
}

// Закрытие модалки загрузки
function closeLoadModal() {
    const modal = $("#kv-cache-load-modal");
    modal.css('display', 'none');
    loadModalData.selectedGroup = null;
    loadModalData.searchQuery = '';
    $("#kv-cache-load-search-input").val('');
    $("#kv-cache-load-confirm-button").prop('disabled', true);
    $("#kv-cache-load-selected-info").text('Файл не выбран');
}

// Отображение списка чатов
function renderLoadModalChats() {
    const chatsList = $("#kv-cache-load-chats-list");
    const currentChatId = loadModalData.currentChatId;
    const chats = loadModalData.chats;
    
    // Обновляем ID и счетчик для текущего чата
    const currentChatGroups = chats[currentChatId] || [];
    const currentCount = currentChatGroups.reduce((sum, g) => sum + g.files.length, 0);
    $(".kv-cache-load-chat-item-current .kv-cache-load-chat-name-text").text((currentChatId || 'unknown') + ' [текущий]');
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
        
        const chatGroups = chats[chatId];
        const totalFiles = chatGroups.reduce((sum, g) => sum + g.files.length, 0);
        const latestGroup = chatGroups[0];
        const dateTime = formatTimestampToDate(latestGroup.timestamp);
        
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
    
    // Устанавливаем активный класс
    if (chatId === 'current') {
        $(".kv-cache-load-chat-item-current").addClass('active');
        chatId = loadModalData.currentChatId;
    } else {
        $(`.kv-cache-load-chat-item[data-chat-id="${chatId}"]`).addClass('active');
    }
    
    // Отображаем файлы выбранного чата
    renderLoadModalFiles(chatId);
    
    // Сбрасываем выбор
    loadModalData.selectedGroup = null;
    $(".kv-cache-load-file-item").removeClass('selected');
    $(".kv-cache-load-file-group").removeClass('selected');
    $("#kv-cache-load-confirm-button").prop('disabled', true);
    $("#kv-cache-load-selected-info").text('Файл не выбран');
}

// Отображение файлов выбранного чата
function renderLoadModalFiles(chatId) {
    const filesList = $("#kv-cache-load-files-list");
    const chats = loadModalData.chats;
    const chatGroups = chats[chatId] || [];
    const searchQuery = loadModalData.searchQuery.toLowerCase();
    
    if (chatGroups.length === 0) {
        filesList.html('<div class="kv-cache-load-empty">Нет файлов для этого чата</div>');
        return;
    }
    
    // Фильтруем группы по поисковому запросу
    const filteredGroups = chatGroups.filter(group => {
        if (!searchQuery) return true;
        const userName = (group.userName || '').toLowerCase();
        const timestamp = group.timestamp;
        const dateTime = formatTimestampToDate(timestamp).toLowerCase();
        return userName.includes(searchQuery) || dateTime.includes(searchQuery) || timestamp.includes(searchQuery);
    });
    
    if (filteredGroups.length === 0) {
        filesList.html('<div class="kv-cache-load-empty">Не найдено файлов по запросу</div>');
        return;
    }
    
    filesList.empty();
    
    // Отображаем группы файлов (сгруппированные по timestamp)
    for (const group of filteredGroups) {
        const dateTime = formatTimestampToDate(group.timestamp);
        const slotsCount = group.files.length;
        const userName = group.userName ? `[${group.userName}]` : '';
        
        const groupElement = $(`
            <div class="kv-cache-load-file-group collapsed" data-group-timestamp="${group.timestamp}">
                <div class="kv-cache-load-file-group-header">
                    <div class="kv-cache-load-file-group-title">
                        <i class="fa-solid fa-calendar"></i>
                        ${dateTime}
                        ${userName ? `<span style="opacity: 0.7;">${userName}</span>` : ''}
                    </div>
                    <div class="kv-cache-load-file-group-info">
                        <span>${slotsCount} слот${slotsCount !== 1 ? 'ов' : ''}</span>
                        <i class="fa-solid fa-chevron-down kv-cache-load-file-group-toggle"></i>
                    </div>
                </div>
                <div class="kv-cache-load-file-group-content">
                </div>
            </div>
        `);
        
        // Добавляем файлы в группу
        const content = groupElement.find('.kv-cache-load-file-group-content');
        for (const file of group.files) {
            const fileSize = formatFileSize(file.size);
            
            const fileItem = $(`
                <div class="kv-cache-load-file-item" data-filename="${file.name}" data-timestamp="${group.timestamp}">
                    <div class="kv-cache-load-file-item-info">
                        <div class="kv-cache-load-file-item-name">
                            <i class="fa-solid fa-file"></i>
                            ${file.name}
                        </div>
                        <div class="kv-cache-load-file-item-meta">
                            <span>${fileSize}</span>
                        </div>
                    </div>
                </div>
            `);
            
            fileItem.on('click', function(e) {
                e.stopPropagation();
                
                // Убираем выделение с других элементов
                $(".kv-cache-load-file-item").removeClass('selected');
                $(".kv-cache-load-file-group").removeClass('selected');
                
                // Выделяем всю группу
                groupElement.addClass('selected');
                fileItem.addClass('selected');
                
                // Сохраняем выбранную группу
                loadModalData.selectedGroup = group;
                
                // Активируем кнопку загрузки
                $("#kv-cache-load-confirm-button").prop('disabled', false);
                $("#kv-cache-load-selected-info").html(`
                    <strong>Выбрано:</strong> ${dateTime} ${userName} (${slotsCount} слот${slotsCount !== 1 ? 'ов' : ''})
                `);
            });
            
            content.append(fileItem);
        }
        
        // Обработчик сворачивания/разворачивания группы
        groupElement.find('.kv-cache-load-file-group-header').on('click', function(e) {
            // Не сворачиваем при клике на файл
            if ($(e.target).closest('.kv-cache-load-file-item').length) return;
            
            // При клике на иконку или заголовок - сворачиваем/разворачиваем
            if ($(e.target).hasClass('kv-cache-load-file-group-toggle') || 
                $(e.target).closest('.kv-cache-load-file-group-title').length ||
                $(e.target).closest('.kv-cache-load-file-group-info').length) {
                groupElement.toggleClass('collapsed');
            }
            
            // При клике на заголовок (не на иконку) также выбираем группу
            if (!$(e.target).hasClass('kv-cache-load-file-group-toggle')) {
                $(".kv-cache-load-file-item").removeClass('selected');
                $(".kv-cache-load-file-group").removeClass('selected');
                groupElement.addClass('selected');
                groupElement.find('.kv-cache-load-file-item').first().addClass('selected');
                
                loadModalData.selectedGroup = group;
                $("#kv-cache-load-confirm-button").prop('disabled', false);
                $("#kv-cache-load-selected-info").html(`
                    <strong>Выбрано:</strong> ${dateTime} ${userName} (${slotsCount} слот${slotsCount !== 1 ? 'ов' : ''})
                `);
            }
        });
        
        filesList.append(groupElement);
    }
}

// Загрузка выбранного кеша
async function loadSelectedCache() {
    const selectedGroup = loadModalData.selectedGroup;
    
    if (!selectedGroup) {
        showToast('error', 'Файл не выбран');
        return;
    }
    
    // Парсим slotId из имён файлов
    const filesToLoad = [];
    for (const file of selectedGroup.files) {
        const filename = file.name;
        if (file.slotId !== undefined) {
            filesToLoad.push({
                filename: filename,
                slotId: file.slotId
            });
        } else {
            // Fallback: парсим из имени файла
            const parsed = parseSaveFilename(filename);
            if (parsed) {
                filesToLoad.push({
                    filename: filename,
                    slotId: parsed.slotId
                });
            } else {
                console.warn('[KV Cache Manager] Не удалось распарсить имя файла для загрузки:', filename);
            }
        }
    }
    
    if (filesToLoad.length === 0) {
        showToast('warning', 'Не найдено файлов для загрузки');
        return;
    }
    
    // Закрываем модалку
    closeLoadModal();
    
    showToast('info', 'Начинаю загрузку кеша...');
    
    console.debug(`[KV Cache Manager] Начинаю загрузку ${filesToLoad.length} файлов:`, filesToLoad);
    
    let loadedCount = 0;
    let errors = [];
    
    for (const { filename, slotId } of filesToLoad) {
        try {
            if (await loadSlotCache(slotId, filename)) {
                loadedCount++;
                console.debug(`[KV Cache Manager] Загружен кеш для слота ${slotId} из файла ${filename}`);
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

async function onLoadButtonClick() {
    await openLoadModal();
}

// Функция вызывается при загрузке расширения
jQuery(async () => {
    // Загружаем HTML из файла
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);

    // Добавляем HTML в контейнер настроек
    $("#extensions_settings").append(settingsHtml);

    // Загружаем настройки при старте
    loadSettings();
    updateSlotsList();
    
    // Считываем все файлы при загрузке через API плагина (для проверки доступности)
    try {
        const filesList = await getFilesList();
        console.debug(`[KV Cache Manager] При загрузке найдено ${filesList.length} файлов сохранений`);
    } catch (e) {
        console.debug('[KV Cache Manager] Не удалось получить список файлов при загрузке (возможно, API плагина недоступен):', e);
    }
    
    // Обновляем список слотов при запуске генерации
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, () => {
        updateSlotsList();
    });

    // Настраиваем обработчики событий
    $("#kv-cache-enabled").on("input", onEnabledChange);
    $("#kv-cache-save-interval").on("input", onSaveIntervalChange);
    $("#kv-cache-max-files").on("input", onMaxFilesChange);
    $("#kv-cache-auto-load").on("input", onAutoLoadChange);
    $("#kv-cache-show-notifications").on("input", onShowNotificationsChange);
    $("#kv-cache-validate").on("input", onValidateChange);
    
    $("#kv-cache-save-button").on("click", onSaveButtonClick);
    $("#kv-cache-load-button").on("click", onLoadButtonClick);
    $("#kv-cache-save-now-button").on("click", onSaveNowButtonClick);
    
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
    });
});
