// Перехватчик генерации для KV Cache Manager

import { getContext } from "../../../extensions.js";
import { normalizeCharacterName, formatTimestampToDate } from './utils.js';
import { getSlotsState, acquireSlot } from './slot-manager.js';
import { loadSlotCache } from './cache-operations.js';
import { getLastCacheForCharacter } from './load-popup.js';
import { parseSaveFilename } from './file-manager.js';
import { showToast } from './ui.js';

// Текущий слот для генерации
let currentSlot = null;

// Флаг режима предзагрузки
let isPreloading = false;

// Установка флага режима предзагрузки
export function setPreloadingMode(enabled) {
    isPreloading = enabled;
    console.debug(`[KV Cache Manager] Режим предзагрузки ${enabled ? 'включен' : 'выключен'}`);
}

// Получение текущего слота
export function getCurrentSlot() {
    return currentSlot;
}

// Получение нормализованного имени персонажа из контекста генерации
// @returns {string|null} - нормализованное имя персонажа или null
export function getNormalizedCharacterNameFromContext() {
    try {
        const context = getContext();
        
        if (!context || !context.characterId) {
            return null;
        }
        
        const character = context.characters[context.characterId];
        if (!character || !character.name) {
            return null;
        }
        
        return normalizeCharacterName(character.name);
    } catch (e) {
        console.error('[KV Cache Manager] Ошибка при получении имени персонажа из контекста:', e);
        return null;
    }
}

// Получение нормализованного имени персонажа из данных события
// @param {any} data - данные события
// @returns {string|null} - нормализованное имя персонажа или null
export function getNormalizedCharacterNameFromData(data) {
    if (!data) {
        return null;
    }
    
    const characterName = data?.char || data?.name || null;
    if (!characterName || typeof characterName !== 'string') {
        return null;
    }
    
    return normalizeCharacterName(characterName);
}

// Функция-перехватчик генерации для загрузки кеша персонажа в слоты
/**
 * Перехватчик генерации для загрузки кеша персонажа в слоты
 * @param {any[]} chat - Массив сообщений чата
 * @param {number} contextSize - Размер контекста
 * @param {function(boolean): void} abort - Функция для остановки генерации
 * @param {string} type - Тип генерации ('normal', 'regenerate', 'swipe', 'quiet', 'impersonate', 'continue')
 */
export async function KVCacheManagerInterceptor(chat, contextSize, abort, type) {
    const MIN_USAGE_FOR_SAVE = 2;
    
    // Пропускаем impersonate
    if (type === 'impersonate') {
        return;
    }
    
    // Обрабатываем тихие генерации только во время предзагрузки
    if (type === 'quiet' && !isPreloading) {
        return;
    }
    
    try {
        // Получаем нормализованное имя персонажа из контекста
        const characterName = getNormalizedCharacterNameFromContext();
        
        if (!characterName) {
            return;
        }
        
        const slotsState = getSlotsState();
        currentSlot = await acquireSlot(characterName, MIN_USAGE_FOR_SAVE);
        
        if (currentSlot === null) {
            console.warn(`[KV Cache Manager] Не удалось получить слот для персонажа ${characterName} при генерации`);
            showToast('error', `Не удалось получить слот для персонажа ${characterName} при генерации`, 'Генерация');
        } else {
            // Управление счетчиком использования происходит здесь, в перехватчике генерации
            // Загружаем кеш только если он еще не загружен в слот
            const slot = slotsState[currentSlot];
            const cacheNotLoaded = !slot?.cacheLoaded;
            
            if (cacheNotLoaded) {
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
            } else {
                console.debug(`[KV Cache Manager] Кеш для персонажа ${characterName} уже загружен в слот ${currentSlot}, пропускаем загрузку`);
            }
            
            // Сохраняем тип генерации в слот для использования в processMessageForAutoSave
            // Увеличение usage происходит в processMessageForAutoSave по событию MESSAGE_RECEIVED
            slotsState[currentSlot].generationType = type;
            console.debug(`[KV Cache Manager] Тип генерации ${type} сохранен для персонажа ${characterName} в слоте ${currentSlot}`);
        }
        
    } catch (error) {
        console.error('[KV Cache Manager] Ошибка в перехватчике генерации:', error);
        showToast('error', `Ошибка при перехвате генерации: ${error.message}`, 'Генерация');
    }
}

// Обработка события готовности настроек генерации
// Устанавливает id_slot для генерации
export function setSlotForGeneration(params) {
    const slot = getCurrentSlot();
    if (slot !== null) {
        params["id_slot"] = slot;
        console.debug(`[KV Cache Manager] Установлен id_slot = ${slot} для генерации`);
    }
}

