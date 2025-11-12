// Автосохранение для KV Cache Manager

import { getNormalizedChatId, normalizeCharacterName } from './utils.js';
import { getSlotsState, findCharacterSlotIndex } from './slot-manager.js';
import { saveCharacterCache } from './cache-operations.js';
import { getExtensionSettings } from './settings.js';
import { getNormalizedCharacterNameFromData } from './generation-interceptor.js';

// Счетчик сообщений для каждого персонажа в каждом чата (для автосохранения)
// Структура: { [chatId]: { [characterName]: count } }
let messageCounters = {};

// Получение счетчиков сообщений
export function getMessageCounters() {
    return messageCounters;
}

// Сброс счетчика для персонажа в чате
export function resetMessageCounter(chatId, characterName) {
    if (messageCounters[chatId] && messageCounters[chatId][characterName] !== undefined) {
        messageCounters[chatId][characterName] = 0;
    }
}

// Сброс всех счетчиков для чата
export function resetChatCounters(chatId) {
    if (messageCounters[chatId]) {
        for (const characterName in messageCounters[chatId]) {
            messageCounters[chatId][characterName] = 0;
        }
    }
}

// Обновление индикатора следующего сохранения
// Показывает минимальное оставшееся количество сообщений среди всех персонажей
export function updateNextSaveIndicator() {
    const extensionSettings = getExtensionSettings();
    
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

// Увеличение счетчика сообщений для конкретного персонажа
// @param {string} characterName - Нормализованное имя персонажа
// @returns {number} - новое значение счётчика или null, если персонаж не найден
export function incrementMessageCounter(characterName) {
    if (!characterName) {
        return null;
    }
    
    const chatId = getNormalizedChatId();
    if (!messageCounters[chatId]) {
        messageCounters[chatId] = {};
    }
    
    if (!messageCounters[chatId][characterName]) {
        messageCounters[chatId][characterName] = 0;
    }
    
    messageCounters[chatId][characterName]++;

    return messageCounters[chatId][characterName];
}

// Проверка необходимости автосохранения и выполнение сохранения
// @param {string} characterName - Нормализованное имя персонажа
// @param {number} currentCount - Текущее значение счётчика
async function checkAndPerformAutoSave(characterName, currentCount) {
    const extensionSettings = getExtensionSettings();
    const interval = extensionSettings.saveInterval;
    
    if (currentCount < interval) {
        return;
    }
    
    // Находим слот, в котором находится персонаж
    const slotIndex = findCharacterSlotIndex(characterName);
    
    if (slotIndex === null) {
        console.warn(`[KV Cache Manager] Не удалось найти слот для сохранения персонажа ${characterName}`);
        return;
    }
    
    // Запускаем автосохранение для этого персонажа
    try {
        const success = await saveCharacterCache(characterName, slotIndex);
        if (success) {
            // Сбрасываем счетчик только после успешного сохранения
            const chatId = getNormalizedChatId();
            messageCounters[chatId][characterName] = 0;
        }
    } catch (e) {
        // При ошибке не сбрасываем счетчик, чтобы попробовать сохранить снова
        console.error(`[KV Cache Manager] Ошибка при автосохранении кеша для персонажа ${characterName}:`, e);
    }
}

// Обработка события получения сообщения для автосохранения
// Увеличивает счетчик сообщений персонажа и проверяет необходимость автосохранения
export async function processMessageForAutoSave(data) {
    const extensionSettings = getExtensionSettings();
    
    if (!extensionSettings.enabled) {
        return;
    }
    
    // Получаем нормализованное имя персонажа из данных события
    const characterName = getNormalizedCharacterNameFromData(data);
    
    if (!characterName) {
        return;
    }
    
    // Увеличиваем счётчик
    const newCount = incrementMessageCounter(characterName);
    
    if (newCount === null) {
        return;
    }
    
    await checkAndPerformAutoSave(characterName, newCount);
    
    updateNextSaveIndicator();
}
