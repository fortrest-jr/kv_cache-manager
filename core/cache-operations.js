// Операции с кешем для KV Cache Manager

import { getContext } from "../../../../extensions.js";

import LlamaApi from '../api/llama-api.js';
import { formatTimestamp, getNormalizedChatId } from '../utils/utils.js';
import { generateSaveFilename, rotateCharacterFiles, validateCacheFile } from './file-manager.js';
import { getAllSlotsInfo, getSlotsState, resetSlotUsage, setSlotCacheLoaded, getSlotsCountFromData, updateSlotsList } from './slot-manager.js';
import { showToast, disableAllSaveButtons, enableAllSaveButtons } from '../ui/ui.js';
import { getExtensionSettings, MIN_USAGE_FOR_SAVE } from '../settings.js';

// Инициализация API клиента
const llamaApi = new LlamaApi();

// Сохранение кеша для слота
// @param {number} slotId - Индекс слота
// @param {string} filename - Имя файла для сохранения
// @param {string} characterName - Имя персонажа (обязательно)
export async function saveSlotCache(slotId, filename, characterName) {
    console.debug(`[KV Cache Manager] Сохранение кеша: слот=${slotId}, filename=${filename}`);
    
    try {
        await llamaApi.saveSlotCache(slotId, filename);
        
        console.debug(`[KV Cache Manager] Кеш успешно сохранен для слота ${slotId}`);
        
        // Проверяем размер сохраненного файла
        const isValid = await validateCacheFile(filename, characterName);
        if (!isValid) {
            return false;
        }
        
        showToast('success', `Кеш для ${characterName} успешно сохранен`);
        
        return true;
    } catch (e) {
        console.error(`[KV Cache Manager] Ошибка сохранения слота ${slotId}:`, e);
        const errorMessage = e.message || 'Неизвестная ошибка';
        if (errorMessage.includes('Таймаут')) {
            showToast('error', `Таймаут при сохранении кеша для ${characterName}`);
        } else {
            showToast('error', `Ошибка при сохранении кеша для ${characterName}: ${errorMessage}`);
        }
        return false;
    }
}

// Загрузка кеша для слота
export async function loadSlotCache(slotId, filename) {
    console.debug(`[KV Cache Manager] Загрузка кеша: слот ${slotId}, файл ${filename}`);
    
    try {
        await llamaApi.loadSlotCache(slotId, filename);
        
        // При любой загрузке кеша сбрасываем счетчик использования в 0 и помечаем кеш как загруженный
        resetSlotUsage(slotId);
        setSlotCacheLoaded(slotId, true);
        
        console.debug(`[KV Cache Manager] Кеш успешно загружен для слота ${slotId}, счетчик использования сброшен в 0, cacheLoaded установлен в true`);
        
        // Обновляем список слотов после загрузки
        updateSlotsList();
        
        return true;
    } catch (e) {
        console.error(`[KV Cache Manager] Ошибка загрузки кеша слота ${slotId}:`, e);
        return false;
    }
}

// Очистка кеша для слота
export async function clearSlotCache(slotId) {
    console.debug(`[KV Cache Manager] Очистка кеша слота ${slotId}`);
    
    try {
        await llamaApi.clearSlotCache(slotId);
        
        console.debug(`[KV Cache Manager] Кеш успешно очищен для слота ${slotId}`);
        
        // Обновляем список слотов после очистки
        updateSlotsList();
        
        return true;
    } catch (e) {
        console.error(`[KV Cache Manager] Ошибка очистки слота ${slotId}:`, e);
        return false;
    }
}

// Очистка всех слотов
export async function clearAllSlotsCache() {
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
            
            // Обновляем список слотов после очистки (clearSlotCache() уже обновляет после каждой очистки, но финальное обновление гарантирует актуальность)
            updateSlotsList();
            
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

// Сохранение кеша для персонажа (автосохранение)
// @param {string} characterName - Нормализованное имя персонажа
// @param {number} slotIndex - индекс слота
// @returns {Promise<boolean>} - true если кеш был сохранен, false если ошибка
export async function saveCharacterCache(characterName, slotIndex) {
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
            
            // Сбрасываем usage после успешного сохранения
            resetSlotUsage(slotIndex);
            
            console.debug(`[KV Cache Manager] Кеш успешно сохранен для персонажа ${characterName}, usage сброшен`);
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

// Сохранение кеша для всех персонажей, которые находятся в слотах
// Используется перед очисткой слотов при смене чата
export async function saveAllSlotsCache() {
    const slotsState = getSlotsState();
    const totalSlots = slotsState.length;
    
    // Отключаем все кнопки сохранения (кроме кнопок отдельных слотов)
    disableAllSaveButtons();
    
    try {
        // Сохраняем кеш для всех персонажей, которые были в слотах перед очисткой
        // Важно: дожидаемся завершения сохранения перед очисткой слотов, чтобы избежать потери данных
        for (let i = 0; i < totalSlots; i++) {
            const slot = slotsState[i];
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
    } finally {
        // Включаем кнопки обратно
        enableAllSaveButtons();
    }
}

// Общая функция сохранения кеша
// Сохраняет всех персонажей, которые находятся в слотах
export async function saveCache(requestTag = false) {
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
    const slotsState = getSlotsState();
    const charactersToSave = [];
    
    slotsState.forEach((slot, slotIndex) => {
        const characterName = slot?.characterName;
        if (characterName && typeof characterName === 'string') {
            charactersToSave.push({
                characterName: characterName,
                slotIndex: slotIndex
            });
        }
    });
    
    if (charactersToSave.length === 0) {
        showToast('warning', 'Нет персонажей в слотах для сохранения');
        return false;
    }
    
    console.debug(`[KV Cache Manager] Начинаю сохранение ${charactersToSave.length} персонажей:`, charactersToSave);
    
    const successfullySaved = []; // Список успешно сохраненных персонажей
    const saveErrors = []; // Список персонажей с проблемами сохранения
    
    const extensionSettings = getExtensionSettings();
    
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
    
    // Возвращаем true при успешном сохранении (хотя бы один персонаж сохранен)
    return successfullySaved.length > 0;
}
