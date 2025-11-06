// KV Cache Manager для SillyTavern
// Расширение для управления KV-кешем llama.cpp
// Этап 2: Обычное сохранение и загрузка кеша по кнопке

// Импортируем необходимые функции
import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

// Имя расширения должно совпадать с именем папки
const extensionName = "SillyTavern-llamacpp-kv_cache-manager";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];

// Имя расширения slot-manager для получения слотов
const slotManagerExtensionName = "llamacpp-slot-manager";
const slotManagerSettings = extension_settings[slotManagerExtensionName] || {};

const defaultSettings = {
    enabled: true,
    saveInterval: 5,
    autoLoadOnChatSwitch: true,
    maxFiles: 10,
    showNotifications: true,
    validateCache: true
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

// Получение URL llama.cpp сервера
function getLlamaUrl() {
    // Пробуем получить из main_api (глобальная переменная SillyTavern)
    if (typeof main_api !== 'undefined' && main_api) {
        // Извлекаем базовый URL (убираем /api если есть)
        const url = main_api.includes('/api') ? main_api.replace('/api', '') : main_api;
        return url;
    }
    
    // Fallback на стандартный URL
    return 'http://127.0.0.1:8080';
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

// Получение номера слота по имени персонажа из slot-manager
function getSlotByCharacterName(characterName) {
    if (!slotManagerSettings.slots || !characterName) {
        return null;
    }
    const slotIndex = slotManagerSettings.slots.findIndex(key => key === characterName);
    return slotIndex !== -1 ? slotIndex : null;
}

// Получение всех активных слотов с именами персонажей из slot-manager
function getActiveSlotsWithCharacters() {
    const result = [];
    if (!slotManagerSettings.slots) {
        return result;
    }
    
    // Проходим по всем слотам slot-manager
    slotManagerSettings.slots.forEach((characterName, slotIndex) => {
        if (typeof characterName === 'string' && characterName) {
            result.push({
                slotId: slotIndex,
                characterName: characterName
            });
        }
    });
    
    return result;
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
    // Получаем слоты из slot-manager
    const slotsWithCharacters = getActiveSlotsWithCharacters();
    
    if (slotsWithCharacters.length === 0) {
        console.debug('[KV Cache Manager] Нет активных слотов в slot-manager');
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
        const slots = await getActiveSlots();
        
        if (slots.length === 0) {
            slotsListElement.html('<p style="color: var(--SmartThemeBodyColor, inherit);">Нет активных слотов для сохранения</p>');
            return;
        }
        
        let html = '<ul style="margin: 5px 0; padding-left: 20px;">';
        for (const { slotId, characterName } of slots) {
            html += `<li style="margin: 3px 0;">Слот ${slotId}: <strong>${characterName}</strong></li>`;
        }
        html += '</ul>';
        html += `<p style="margin-top: 5px; font-size: 0.9em; color: var(--SmartThemeBodyColor, inherit);">Всего: ${slots.length} слот(ов)</p>`;
        
        slotsListElement.html(html);
    } catch (e) {
        console.error('[KV Cache Manager] Ошибка при обновлении списка слотов:', e);
        slotsListElement.html('<p style="color: var(--SmartThemeBodyColor, inherit);">Ошибка загрузки слотов</p>');
    }
}

// Сохранение кеша для слота
async function saveSlotCache(slotId, filename) {
    const llamaUrl = getLlamaUrl();
    const url = `${llamaUrl}/slots/${slotId}?action=save`;
    const requestBody = { filename: filename };
    
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
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[KV Cache Manager] Ошибка сохранения слота ${slotId}: ${response.status} ${errorText}`);
            return false;
        }
        
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
    
    // Получаем активные слоты
    const slots = await getActiveSlots();
    if (slots.length === 0) {
        showToast('warning', 'Нет активных слотов для сохранения');
        return;
    }
    
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
    
    // Получаем активные слоты
    const slots = await getActiveSlots();
    if (slots.length === 0) {
        showToast('warning', 'Нет активных слотов для сохранения');
        return;
    }
    
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
    
    $("#kv-cache-save-button").on("click", onSaveButtonClick);
    $("#kv-cache-load-button").on("click", onLoadButtonClick);
    $("#kv-cache-save-now-button").on("click", onSaveNowButtonClick);

    // Загружаем настройки при старте
    loadSettings();
    
    // Обновляем список слотов при старте
    updateSlotsList();
    
    // Обновляем список слотов периодически (каждые 5 секунд)
    setInterval(() => {
        updateSlotsList();
    }, 5000);
    
    // Обновляем список слотов при изменении настроек slot-manager
    // Слушаем изменения в extension_settings через события или периодически
    // Также обновляем при клике на кнопки сохранения
    $("#kv-cache-save-button, #kv-cache-save-now-button").on("click", () => {
        setTimeout(() => updateSlotsList(), 1000);
    });
});
