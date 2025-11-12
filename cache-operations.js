// Операции с кешем для KV Cache Manager

import LlamaApi from './llama-api.js';
import { formatTimestamp, getNormalizedChatId } from './utils.js';
import { generateSaveFilename, getFilesList, deleteFile, rotateCharacterFiles } from './file-manager.js';
import { getAllSlotsInfo, getSlotsState, resetSlotUsage, setSlotCacheLoaded, getSlotsCountFromData } from './slot-manager.js';

// Инициализация API клиента
const llamaApi = new LlamaApi();

// Константы
const MIN_FILE_SIZE_MB = 1; // Минимальный размер файла кеша в МБ (файлы меньше этого размера считаются невалидными)
const FILE_CHECK_DELAY_MS = 500; // Задержка перед проверкой размера файла после сохранения (мс)

// Сохранение кеша для слота
// @param {number} slotId - Индекс слота
// @param {string} filename - Имя файла для сохранения
// @param {string} characterName - Имя персонажа (обязательно)
export async function saveSlotCache(slotId, filename, characterName, callbacks = {}) {
    const { onShowToast } = callbacks;
    
    console.debug(`[KV Cache Manager] Сохранение кеша: слот=${slotId}, filename=${filename}`);
    
    try {
        await llamaApi.saveSlotCache(slotId, filename);
        
        console.debug(`[KV Cache Manager] Кеш успешно сохранен для слота ${slotId}`);
        
        // Проверяем размер сохраненного файла
        try {
            // Ждем немного, чтобы файл точно был сохранен на сервере
            await new Promise(resolve => setTimeout(resolve, FILE_CHECK_DELAY_MS));
            
            const filesList = await getFilesList({ onShowToast });
            const savedFile = filesList.find(file => file.name === filename);
            
            if (savedFile) {
                const fileSizeMB = savedFile.size / (1024 * 1024); // Размер в мегабайтах
                
                if (fileSizeMB < MIN_FILE_SIZE_MB) {
                    // Файл меньше минимального размера - считаем невалидным и удаляем
                    console.warn(`[KV Cache Manager] Файл ${filename} слишком мал (${fileSizeMB.toFixed(2)} МБ), удаляем как невалидный`);
                    await deleteFile(filename);
                    if (onShowToast) {
                        onShowToast('warning', `Файл кеша для ${characterName} слишком мал, не сохранён`);
                    }
                    return false;
                }
            }
        } catch (e) {
            console.warn(`[KV Cache Manager] Не удалось проверить размер файла ${filename}:`, e);
            // Продолжаем, даже если не удалось проверить размер
        }
        
        if (onShowToast) {
            onShowToast('success', `Кеш для ${characterName} успешно сохранен`);
        }
        
        return true;
    } catch (e) {
        console.error(`[KV Cache Manager] Ошибка сохранения слота ${slotId}:`, e);
        const errorMessage = e.message || 'Неизвестная ошибка';
        if (onShowToast) {
            if (errorMessage.includes('Таймаут')) {
                onShowToast('error', `Таймаут при сохранении кеша для ${characterName}`);
            } else {
                onShowToast('error', `Ошибка при сохранении кеша для ${characterName}: ${errorMessage}`);
            }
        }
        return false;
    }
}

// Загрузка кеша для слота
export async function loadSlotCache(slotId, filename, callbacks = {}) {
    console.debug(`[KV Cache Manager] Загрузка кеша: слот ${slotId}, файл ${filename}`);
    
    try {
        await llamaApi.loadSlotCache(slotId, filename);
        
        // При любой загрузке кеша сбрасываем счетчик использования в 0 и помечаем кеш как загруженный
        resetSlotUsage(slotId);
        setSlotCacheLoaded(slotId, true);
        
        console.debug(`[KV Cache Manager] Кеш успешно загружен для слота ${slotId}, счетчик использования сброшен в 0, cacheLoaded установлен в true`);
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
        return true;
    } catch (e) {
        console.error(`[KV Cache Manager] Ошибка очистки слота ${slotId}:`, e);
        return false;
    }
}

// Очистка всех слотов
export async function clearAllSlotsCache(callbacks = {}) {
    const { onShowToast, onUpdateSlotsList } = callbacks;
    
    try {
        // Получаем информацию о всех слотах
        const slotsData = await getAllSlotsInfo({ onShowToast });
        
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
                if (onShowToast) {
                    onShowToast('warning', `Очищено ${clearedCount} из ${totalSlots} слотов. Ошибки: ${errors.join(', ')}`, 'Очистка кеша');
                }
            } else {
                console.debug(`[KV Cache Manager] Успешно очищено ${clearedCount} слотов`);
                if (onShowToast) {
                    onShowToast('success', `Успешно очищено ${clearedCount} слотов`, 'Очистка кеша');
                }
            }
            
            // Обновляем список слотов после очистки
            if (onUpdateSlotsList) {
                setTimeout(() => onUpdateSlotsList(), 1000);
            }
            
            return true;
        } else {
            console.error(`[KV Cache Manager] Не удалось очистить слоты. Ошибки: ${errors.join(', ')}`);
            if (onShowToast) {
                onShowToast('error', `Не удалось очистить слоты. Ошибки: ${errors.join(', ')}`, 'Очистка кеша');
            }
            return false;
        }
    } catch (e) {
        console.error('[KV Cache Manager] Ошибка при очистке всех слотов:', e);
        if (onShowToast) {
            onShowToast('error', `Ошибка при очистке слотов: ${e.message}`, 'Очистка кеша');
        }
        return false;
    }
}

// Сохранение кеша для персонажа (автосохранение)
// @param {string} characterName - Нормализованное имя персонажа
// @param {number} slotIndex - индекс слота
// @returns {Promise<boolean>} - true если кеш был сохранен, false если ошибка
export async function saveCharacterCache(characterName, slotIndex, callbacks = {}) {
    if (!characterName || typeof characterName !== 'string') {
        return false;
    }
    
    if (slotIndex === null || slotIndex === undefined) {
        return false;
    }
    
    const { onShowToast, getExtensionSettings } = callbacks;
    
    try {
        const chatId = getNormalizedChatId();
        const timestamp = formatTimestamp();
        const filename = generateSaveFilename(chatId, timestamp, characterName);
        
        console.debug(`[KV Cache Manager] Сохранение кеша для персонажа ${characterName} в слот ${slotIndex}`);
        
        const success = await saveSlotCache(slotIndex, filename, characterName, { onShowToast });
        
        if (success) {
            // Выполняем ротацию файлов для этого персонажа
            const extensionSettings = getExtensionSettings ? getExtensionSettings() : {};
            await rotateCharacterFiles(characterName, {
                maxFiles: extensionSettings.maxFiles || 10,
                showNotifications: extensionSettings.showNotifications !== false,
                onShowToast
            });
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

// Общая функция сохранения кеша
// Сохраняет всех персонажей, которые находятся в слотах
export async function saveCache(requestTag = false, callbacks = {}) {
    const { onShowToast, onUpdateNextSaveIndicator, getExtensionSettings } = callbacks;
    let tag = null;
    
    // Запрашиваем тег, если нужно
    if (requestTag) {
        tag = prompt('Введите тег для сохранения:');
        if (!tag || !tag.trim()) {
            if (tag !== null) {
                // Пользователь нажал OK, но не ввел тег
                if (onShowToast) {
                    onShowToast('error', 'Тег не может быть пустым');
                }
            }
            return false; // Отмена сохранения
        }
        tag = tag.trim();
    }
    
    // Получаем нормализованный ID чата
    const chatId = getNormalizedChatId();
    
    if (onShowToast) {
        onShowToast('info', 'Начинаю сохранение кеша...');
    }
    
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
        if (onShowToast) {
            onShowToast('warning', 'Нет персонажей в слотах для сохранения');
        }
        return false;
    }
    
    console.debug(`[KV Cache Manager] Начинаю сохранение ${charactersToSave.length} персонажей:`, charactersToSave);
    
    const successfullySaved = []; // Список успешно сохраненных персонажей
    const saveErrors = []; // Список персонажей с проблемами сохранения
    
    const extensionSettings = getExtensionSettings ? getExtensionSettings() : {};
    
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
            
            if (await saveSlotCache(slotIndex, filename, characterName, { onShowToast })) {
                successfullySaved.push(characterName);
                console.debug(`[KV Cache Manager] Сохранен кеш для персонажа ${characterName}: ${filename}`);
                
                // Выполняем ротацию файлов для этого персонажа (только для автосохранений)
                if (!tag) {
                    await rotateCharacterFiles(characterName, {
                        maxFiles: extensionSettings.maxFiles || 10,
                        showNotifications: extensionSettings.showNotifications !== false,
                        onShowToast
                    });
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
    if (!tag && successfullySaved.length > 0 && onUpdateNextSaveIndicator) {
        onUpdateNextSaveIndicator();
    }
    
    // Возвращаем true при успешном сохранении (хотя бы один персонаж сохранен)
    return successfullySaved.length > 0;
}
