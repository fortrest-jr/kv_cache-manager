// Перехватчик генерации для KV Cache Manager

import { getContext } from "../../../extensions.js";
import { formatTimestampToDate } from '../utils/utils.js';
import { getSlotsState, acquireSlot } from '../core/slot-manager.js';
import { loadSlotCache } from '../core/cache-operations.js';
import { getLastCacheForCharacter, parseSaveFilename } from '../core/file-manager.js';
import { showToast } from '../ui/ui.js';
import { getNormalizedCharacterNameFromContext, getNormalizedCharacterNameFromData } from '../utils/character-utils.js';
import { MIN_USAGE_FOR_SAVE } from '../settings.js';

// Текущий слот для генерации
let currentSlot = null;

// Флаг режима предзагрузки
let isPreloading = false;

// Текущий персонаж для предзагрузки (используется вместо контекста, т.к. контекст может быть не обновлен)
let currentPreloadCharacter = null;

// Установка флага режима предзагрузки
export function setPreloadingMode(enabled) {
    isPreloading = enabled;
    if (!enabled) {
        currentPreloadCharacter = null; // Очищаем при выключении
    }
    console.debug(`[KV Cache Manager] Режим предзагрузки ${enabled ? 'включен' : 'выключен'}`);
}

// Установка текущего персонажа для предзагрузки
export function setCurrentPreloadCharacter(normalizedName) {
    currentPreloadCharacter = normalizedName;
    if (normalizedName) {
        console.debug(`[KV Cache Manager] Установлен текущий персонаж для предзагрузки: ${normalizedName}`);
    } else {
        console.debug(`[KV Cache Manager] Очищен текущий персонаж для предзагрузки`);
    }
}

// Получение текущего слота
export function getCurrentSlot() {
    return currentSlot;
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
    // Пропускаем impersonate
    if (type === 'impersonate') {
        return;
    }
    
    // Обрабатываем тихие генерации только во время предзагрузки
    if (type === 'quiet' && !isPreloading) {
        return;
    }
    
    try {
        // В режиме предзагрузки для тихих генераций используем сохраненное имя персонажа
        // вместо контекста, т.к. контекст может быть еще не обновлен после forceChId
        let characterName;
        if (type === 'quiet' && isPreloading && currentPreloadCharacter) {
            characterName = currentPreloadCharacter;
            console.debug(`[KV Cache Manager] Используем сохраненное имя персонажа для предзагрузки: ${characterName} (вместо контекста)`);
        } else {
            // Для обычных генераций используем контекст
            characterName = getNormalizedCharacterNameFromContext();
        }
        
        if (!characterName) {
            console.warn(`[KV Cache Manager] Не удалось определить имя персонажа (type: ${type}, isPreloading: ${isPreloading}, currentPreloadCharacter: ${currentPreloadCharacter})`);
            return;
        }
        
        console.debug(`[KV Cache Manager] Перехватчик генерации для персонажа: ${characterName} (type: ${type})`);
        
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

