// Управление слотами для KV Cache Manager

import { getContext } from "../../../extensions.js";
import { getGroupMembers, selected_group, groups } from '../../../group-chats.js';
import LlamaApi from '../api/llama-api.js';
import { normalizeCharacterName, getNormalizedChatId } from '../utils/utils.js';
import { showToast } from '../ui/ui.js';
import { saveCharacterCache, saveAllSlotsCache, clearAllSlotsCache } from './cache-operations.js';
import { getExtensionSettings } from '../settings.js';

// Инициализация API клиента
const llamaApi = new LlamaApi();

// Состояние слотов
let slotsState = [];

// Переменная для отслеживания предыдущего чата
let previousChatId = 'unknown';

// Получение состояния слотов
export function getSlotsState() {
    return slotsState;
}

// Получение количества слотов из ответа /slots
export function getSlotsCountFromData(slotsData) {
    if (Array.isArray(slotsData)) {
        return slotsData.length;
    } else if (typeof slotsData === 'object' && slotsData !== null) {
        return Object.keys(slotsData).length;
    }
    return 0;
}

// Получение информации о всех слотах через /slots
export async function getAllSlotsInfo() {
    try {
        const slotsData = await llamaApi.getSlots();
        return slotsData;
    } catch (e) {
        console.debug('[KV Cache Manager] Ошибка получения информации о слотах:', e);
        const errorMessage = e.message || String(e);
        showToast('error', `Ошибка получения информации о слотах: ${errorMessage}`);
        return null;
    }
}

// Создание объекта слота с персонажем
// @param {string} characterName - Нормализованное имя персонажа
export function createSlotWithCharacter(characterName) {
    return {
        characterName: characterName,
        usage: 0,
        cacheLoaded: false,
        generationType: null
    };
}

// Создание объекта пустого слота
export function createEmptySlot() {
    return createSlotWithCharacter(undefined);
}

// Инициализация слотов для режима групповых чатов
export async function initializeSlots() {
    const slotsData = await getAllSlotsInfo();
    const totalSlots = slotsData ? getSlotsCountFromData(slotsData) : 4;
    
    // Инициализируем массив объектов состояния слотов
    slotsState = [];
    
    // Создаем объекты для каждого слота
    for (let i = 0; i < totalSlots; i++) {
        slotsState[i] = createEmptySlot();
    }
    
    console.debug(`[KV Cache Manager] Инициализировано ${totalSlots} слотов для режима групповых чатов`);
    
    // Обновляем UI
    updateSlotsList();
}

// Получение списка нормализованных имен персонажей текущего чата
// Использует правильный подход SillyTavern для определения персонажей
// ВСЕГДА возвращает нормализованные имена
export function getNormalizedChatCharacters() {
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
                const normalizedName = normalizeCharacterName(characterName);
                console.debug(`[KV Cache Manager] Обычный чат, найден персонаж: ${characterName} (нормализовано: ${normalizedName})`);
                return [normalizedName];
            }
            return [];
        } else {
            // Групповой чат
            // Используем getGroupMembers() для получения массива объектов персонажей
            const groupMembers = getGroupMembers();
            
            if (!groupMembers || groupMembers.length === 0) {
                console.warn('[KV Cache Manager] Не найдено участников группового чата');
                return [];
            }
            
            // Извлекаем и нормализуем имена персонажей из массива объектов
            const normalizedNames = groupMembers
                .map(member => member?.name)
                .filter(name => name && typeof name === 'string')
                .map(name => normalizeCharacterName(name));
            
            console.debug(`[KV Cache Manager] Групповой чат, найдено ${normalizedNames.length} персонажей (нормализовано)`);
            return normalizedNames;
        }
    } catch (e) {
        console.error('[KV Cache Manager] Ошибка при получении персонажей чата:', e);
        return [];
    }
}

// Распределение персонажей по слотам из текущего чата
// Очищает старых персонажей из других чатов
export async function assignCharactersToSlots() {
    // Убеждаемся, что слоты инициализированы
    if (slotsState.length === 0) {
        await initializeSlots();
    }
    
    // Получаем нормализованные имена персонажей текущего чата
    const chatCharacters = getNormalizedChatCharacters();
    
    const totalSlots = slotsState.length;
    
    // Полностью очищаем все слоты (сохранение должно было произойти до вызова этой функции)
    for (let i = 0; i < totalSlots; i++) {
        slotsState[i] = createEmptySlot();
    }
    
    if (chatCharacters.length === 0) {
        console.debug('[KV Cache Manager] Не найдено персонажей в текущем чате для распределения по слотам');
        updateSlotsList();
        return;
    }
    
    console.debug(`[KV Cache Manager] Распределение ${chatCharacters.length} персонажей по ${totalSlots} слотам`);
    
    // Распределяем персонажей по слотам: идем по индексу, пока не закончатся либо слоты, либо персонажи
    // Имена уже нормализованы из getNormalizedChatCharacters()
    for (let i = 0; i < totalSlots && i < chatCharacters.length; i++) {
        slotsState[i] = createSlotWithCharacter(chatCharacters[i]);
    }
    
    console.debug(`[KV Cache Manager] Персонажи распределены по слотам:`, slotsState);
    
    // Обновляем UI
    updateSlotsList();
}

// Поиск индекса слота для персонажа (если персонаж уже в слоте)
// @param {string} characterName - Нормализованное имя персонажа
// @returns {number|null} - Индекс слота или null, если персонаж не найден в слотах
export function findCharacterSlotIndex(characterName) {
    // characterName должен быть уже нормализован
    const index = slotsState.findIndex(slot => {
        const slotName = slot?.characterName;
        return slotName && slotName === characterName;
    });
    
    return index !== -1 ? index : null;
}

// Получение слота для персонажа
// 1. Если персонаж уже в слоте - возвращаем этот слот
// 2. Если нет - ищем пустой слот, возвращаем его
// 3. Если пустых нет - освобождаем слот с наименьшим использованием и возвращаем его
// Функция занимается только управлением слотами, не управляет счетчиком использования
// @param {string} characterName - Нормализованное имя персонажа (используется как идентификатор)
// @param {number} minUsageForSave - Минимальное количество использований для сохранения (по умолчанию 2)
// @param {Set<string>} protectedCharacters - Набор нормализованных имен персонажей, которых нельзя вытеснять (опционально)
export async function acquireSlot(characterName, minUsageForSave = 1, protectedCharacters = null) {
    // characterName должен быть уже нормализован
    
    // 1. Проверяем, есть ли персонаж уже в слоте - если да, возвращаем этот слот
    const existingIndex = findCharacterSlotIndex(characterName);
    if (existingIndex !== null) {
        // Персонаж уже в слоте - возвращаем существующий слот
        console.debug(`[KV Cache Manager] Персонаж ${characterName} уже в слоте ${existingIndex}, счетчик: ${slotsState[existingIndex].usage || 0}`);
        updateSlotsList();
        return existingIndex;
    }
    
    // 2. Персонаж не в слоте - ищем пустой слот
    const freeSlotIndex = slotsState.findIndex(slot => !slot?.characterName);
    if (freeSlotIndex !== -1) {
        // Найден пустой слот - устанавливаем персонажа туда (храним нормализованное имя)
        // Счетчик использования всегда начинается с 0, управление счетчиком вне этой функции
        slotsState[freeSlotIndex] = createSlotWithCharacter(characterName);
        console.debug(`[KV Cache Manager] Персонаж ${characterName} установлен в пустой слот ${freeSlotIndex}, счетчик: ${slotsState[freeSlotIndex].usage}`);
        updateSlotsList();
        return freeSlotIndex;
    }
    
    // 3. Пустых слотов нет - находим слот с наименьшим использованием и освобождаем его
    // Пропускаем защищенных персонажей, если они указаны
    let minUsage = Infinity;
    let minUsageIndex = -1;
    
    for (let i = 0; i < slotsState.length; i++) {
        const slot = slotsState[i];
        const slotCharacterName = slot?.characterName;
        
        // Пропускаем защищенных персонажей
        if (protectedCharacters && slotCharacterName && protectedCharacters.has(slotCharacterName)) {
            continue;
        }
        
        const currentUsage = slot?.usage || 0;
        if (currentUsage < minUsage) {
            minUsage = currentUsage;
            minUsageIndex = i;
        }
    }
    
    if (minUsageIndex === -1) {
        console.warn('[KV Cache Manager] Не удалось найти слот для персонажа (возможно, все слоты заняты защищенными персонажами)');
        return null;
    }
    
    // Освобождаем слот с наименьшим использованием
    const evictedSlot = slotsState[minUsageIndex];
    const evictedCharacter = evictedSlot?.characterName;
    
    if (evictedCharacter && typeof evictedCharacter === 'string') {
        const usageCount = evictedSlot.usage;
        
        // Сохраняем кеш перед вытеснением только если персонаж использовал слот минимум N раз
        if (usageCount >= minUsageForSave) {
            await saveCharacterCache(evictedCharacter, minUsageIndex);
        } else {
            console.debug(`[KV Cache Manager] Пропускаем сохранение кеша для ${evictedCharacter} (использование: ${usageCount} < ${minUsageForSave})`);
        }
    }
    
    // Устанавливаем персонажа в освобожденный слот
    // Храним нормализованное имя (characterName уже нормализован)
    // Счетчик использования всегда начинается с 0, управление счетчиком вне этой функции
    slotsState[minUsageIndex] = createSlotWithCharacter(characterName);
    
    console.debug(`[KV Cache Manager] Персонаж ${characterName} установлен в слот ${minUsageIndex}${evictedCharacter ? ` (вытеснен ${evictedCharacter}, использование: ${minUsage})` : ' (свободный слот)'}, счетчик: ${slotsState[minUsageIndex].usage}`);
    
    updateSlotsList();
    
    return minUsageIndex;
}

// Обновление UI с информацией о слотах
// Обновление списка слотов в UI (объединенный виджет)
export async function updateSlotsList() {
    const slotsListElement = $("#kv-cache-slots-list");
    if (slotsListElement.length === 0) {
        return;
    }
    
    try {
        // Получаем информацию о слотах для определения общего количества
        const slotsData = await getAllSlotsInfo();
        const totalSlots = slotsData ? getSlotsCountFromData(slotsData) : 0;
        
        let html = '<ul style="margin: 5px 0; padding-left: 0px;">';
        let usedCount = 0;
        
        for (let i = 0; i < slotsState.length; i++) {
            const slot = slotsState[i];
            const characterName = slot?.characterName;
            const isUsed = characterName && typeof characterName === 'string';
            
            if (isUsed) {
                usedCount++;
            }
            
            html += `<li style="margin: 3px 0; display: flex; align-items: center; gap: 5px;">`;
            
            // Кнопка сохранения (только для занятых слотов)
            if (isUsed) {
                html += `<button class="kv-cache-save-slot-button" data-slot-index="${i}" data-character-name="${characterName}" style="background: none; cursor: pointer; padding: 2px 4px; display: inline-flex; align-items: center; color: var(--SmartThemeBodyColor, #888); margin-left: 0;" title="Сохранить кеш для ${characterName}">`;
                html += `<i class="fa-solid fa-floppy-disk" style="font-size: 0.85em;"></i>`;
                html += `</button>`;
            } else {
                // Пустое место для выравнивания, если слот свободен
                html += `<span style="width: 20px; display: inline-block;"></span>`;
            }
            
            html += `<span>Слот <strong>${i}</strong>: `;
            
            if (isUsed) {
                const messageCount = slot?.usage || 0;
                html += `<span style="color: var(--SmartThemeBodyColor, inherit);">${characterName}</span> `;
                html += `<span style="font-size: 0.85em; color: var(--SmartThemeBodyColor, #888);">[сообщений: ${messageCount}]</span>`;
            } else {
                html += `<span style="color: #888; font-style: italic;">(свободен)</span>`;
            }
            
            html += `</span></li>`;
        }
        
        html += '</ul>';
        html += `<p style="margin-top: 5px; font-size: 0.9em; color: var(--SmartThemeBodyColor, inherit);">Занято: ${usedCount} / ${totalSlots} (свободно: ${totalSlots - usedCount})</p>`;
        
        slotsListElement.html(html);
    } catch (e) {
        console.error('[KV Cache Manager] Ошибка при обновлении списка слотов:', e);
        const errorMessage = e.message || 'Неизвестная ошибка';
        slotsListElement.html(`<p style="color: var(--SmartThemeBodyColor, inherit);">Ошибка загрузки слотов: ${errorMessage}</p>`);
    }
}

// Увеличение счетчика использования слота
export function incrementSlotUsage(slotIndex) {
    if (slotsState[slotIndex]) {
        slotsState[slotIndex].usage = (slotsState[slotIndex].usage || 0) + 1;
    }
}

// Установка флага загрузки кеша для слота
export function setSlotCacheLoaded(slotIndex, loaded = true) {
    if (slotsState[slotIndex]) {
        slotsState[slotIndex].cacheLoaded = loaded;
    }
}

// Сброс счетчика использования слота
export function resetSlotUsage(slotIndex) {
    if (slotsState[slotIndex]) {
        slotsState[slotIndex].usage = 0;
    }
}

// Инициализация previousChatId
export function initializePreviousChatId() {
    previousChatId = 'unknown';
}

// Обработка события смены чата
// Сохраняет кеш текущих персонажей, очищает слоты и распределяет персонажей нового чата
export async function redistributeCharacters() {
    const currentChatId = getNormalizedChatId();
    const previousChatIdNormalized = previousChatId;
    const extensionSettings = getExtensionSettings();
    
    // Обновляем previousChatId для следующего события (никогда не присваиваем 'unknown')
    if (currentChatId !== 'unknown') {
        previousChatId = currentChatId;
    }
    
    // Обрабатываем смену чата
    await processChatChange(previousChatIdNormalized, currentChatId, extensionSettings);
}

// Внутренняя функция обработки смены чата
// Сохраняет кеш, очищает слоты и распределяет персонажей нового чата
async function processChatChange(previousChatIdParam, currentChatId, extensionSettings) {
    // Проверяем, изменилось ли имя чата (и не меняется ли оно на "unknown")
    // previousChatId может быть 'unknown' только при первой смене чата
    const chatIdChanged = currentChatId !== 'unknown' &&
                          previousChatIdParam !== currentChatId;
    
    // Если имя чата не изменилось или меняется с/на unknown - не запускаем очистку
    if (!chatIdChanged) {
        console.debug(`[KV Cache Manager] Имя чата не изменилось (${previousChatIdParam} -> ${currentChatId}) или меняется с/на unknown, пропускаем очистку`);
        return false;
    }
    
    // Проверяем настройку очистки при смене чата
    if (!extensionSettings.clearOnChatChange) {
        console.debug(`[KV Cache Manager] Очистка при смене чата отключена в настройках`);
        return false;
    }
    
    console.debug(`[KV Cache Manager] Смена чата: ${previousChatIdParam} -> ${currentChatId}`);
    
    // ВАЖНО: Сначала сохраняем кеш для всех персонажей, которые были в слотах
    await saveAllSlotsCache();
    
    // Затем очищаем все слоты на сервере
    await clearAllSlotsCache();
    
    // Распределяем персонажей по слотам (групповой режим всегда включен)
    await assignCharactersToSlots();
    
    return true;
}
