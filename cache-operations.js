// Операции с кешем для KV Cache Manager

import LlamaApi from './llama-api.js';
import { formatTimestamp, getNormalizedChatId } from './utils.js';
import { generateSaveFilename, getFilesList, deleteFile, rotateCharacterFiles } from './file-manager.js';
import { getAllSlotsInfo, getSlotsState, resetSlotUsage, setSlotCacheLoaded, getSlotsCountFromData, updateSlotsList, acquireSlot } from './slot-manager.js';
import { showToast, disableAllSaveButtons, enableAllSaveButtons } from './ui.js';
import { getExtensionSettings } from './settings.js';
import { getContext } from "../../../extensions.js";
import { eventSource, event_types } from "../../../../script.js";
import { setPreloadingMode } from './generation-interceptor.js';

// Инициализация API клиента
const llamaApi = new LlamaApi();

// Константы
const MIN_FILE_SIZE_MB = 1; // Минимальный размер файла кеша в МБ (файлы меньше этого размера считаются невалидными)
const FILE_CHECK_DELAY_MS = 500; // Задержка перед проверкой размера файла после сохранения (мс)

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
        try {
            // Ждем немного, чтобы файл точно был сохранен на сервере
            await new Promise(resolve => setTimeout(resolve, FILE_CHECK_DELAY_MS));
            
            const filesList = await getFilesList();
            const savedFile = filesList.find(file => file.name === filename);
            
            if (savedFile) {
                const fileSizeMB = savedFile.size / (1024 * 1024); // Размер в мегабайтах
                
                if (fileSizeMB < MIN_FILE_SIZE_MB) {
                    // Файл меньше минимального размера - считаем невалидным и удаляем
                    console.warn(`[KV Cache Manager] Файл ${filename} слишком мал (${fileSizeMB.toFixed(2)} МБ), удаляем как невалидный`);
                    await deleteFile(filename);
                    showToast('warning', `Файл кеша для ${characterName} слишком мал, не сохранён`);
                    return false;
                }
            }
        } catch (e) {
            console.warn(`[KV Cache Manager] Не удалось проверить размер файла ${filename}:`, e);
            // Продолжаем, даже если не удалось проверить размер
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
            
            // Обновляем список слотов после очистки
            setTimeout(() => updateSlotsList(), 1000);
            
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
    const MIN_USAGE_FOR_SAVE = 2;
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

// Предзагрузка кеша для выбранных персонажей
// @param {Array<{name: string, normalizedName: string, characterId: string, avatar: string, isMuted: boolean}>} characters - Массив персонажей для предзагрузки
export async function preloadCharactersCache(characters) {
    // Проверяем, что чат групповой
    const context = getContext();
    if (!context || context.groupId === null || context.groupId === undefined) {
        showToast('error', 'Предзагрузка доступна только для групповых чатов');
        return false;
    }
    
    if (!characters || characters.length === 0) {
        showToast('warning', 'Не выбрано персонажей для предзагрузки');
        return false;
    }
    
    // Включаем режим предзагрузки
    setPreloadingMode(true);
    
    // Отключаем кнопки сохранения
    disableAllSaveButtons();
    
    try {
        showToast('info', `Начинаю предзагрузку кеша для ${characters.length} персонажей...`, 'Предзагрузка');
        
        let preloadedCount = 0;
        let errors = [];
        
        // Обрабатываем каждого персонажа последовательно
        for (let i = 0; i < characters.length; i++) {
            const character = characters[i];
            const characterName = character.name;
            const normalizedName = character.normalizedName;
            const characterId = character.characterId;
            
            if (!characterId) {
                errors.push(`${characterName}: не найден ID персонажа`);
                continue;
            }
            
            try {
                showToast('info', `Предзагрузка ${i + 1}/${characters.length}: ${characterName}...`, 'Предзагрузка');
                
                // Получаем/занимаем слот для персонажа
                const slotIndex = await acquireSlot(normalizedName, 0); // Не сохраняем при вытеснении во время предзагрузки
                
                if (slotIndex === null) {
                    errors.push(`${characterName}: не удалось получить слот`);
                    continue;
                }
                
                console.debug(`[KV Cache Manager] Предзагрузка для персонажа ${characterName} в слот ${slotIndex}`);
                
                // generateQuietPrompt должен быть доступен глобально в SillyTavern
                if (typeof generateQuietPrompt === 'undefined') {
                    throw new Error('generateQuietPrompt не доступен');
                }
                
                // Создаем Promise для ожидания события GENERATION_AFTER_COMMANDS
                let generationStarted = false;
                let abortHandler = null;
                
                const generationPromise = new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        if (!generationStarted) {
                            eventSource.off(event_types.GENERATION_AFTER_COMMANDS, handler);
                            reject(new Error('Таймаут ожидания начала генерации'));
                        }
                    }, 30000); // 30 секунд таймаут
                    
                    const handler = () => {
                        generationStarted = true;
                        clearTimeout(timeout);
                        eventSource.off(event_types.GENERATION_AFTER_COMMANDS, handler);
                        
                        // Останавливаем генерацию после обработки промпта
                        // Пытаемся получить abortController из глобального контекста
                        if (typeof getAbortController === 'function') {
                            const controller = getAbortController();
                            if (controller) {
                                controller.abort();
                                console.debug(`[KV Cache Manager] Генерация для ${characterName} остановлена после обработки промпта`);
                            }
                        } else if (typeof abortGeneration === 'function') {
                            // Альтернативный способ остановки генерации
                            abortGeneration();
                            console.debug(`[KV Cache Manager] Генерация для ${characterName} остановлена после обработки промпта`);
                        }
                        
                        resolve();
                    };
                    
                    abortHandler = handler;
                    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, handler);
                });
                
                try {
                    // Запускаем генерацию через generateQuietPrompt
                    // generateQuietPrompt возвращает промис
                    const generationTask = generateQuietPrompt({
                        quietPrompt: 'Hello',
                        forceChId: characterId,
                        quietToLoud: false,
                        responseLength: 10
                    });
                    
                    // Ждем события GENERATION_AFTER_COMMANDS (это произойдет раньше, чем завершится генерация)
                    await generationPromise;
                    
                    // Останавливаем промис генерации, если это возможно
                    if (generationTask && typeof generationTask.cancel === 'function') {
                        generationTask.cancel();
                    }
                    
                    // Ждем немного, чтобы генерация точно остановилась
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                } catch (e) {
                    // Если ошибка связана с остановкой генерации - это нормально
                    if (e.message && (e.message.includes('aborted') || e.message.includes('AbortError') || e.message.includes('cancelled'))) {
                        console.debug(`[KV Cache Manager] Генерация для ${characterName} остановлена`);
                    } else if (!e.message || !e.message.includes('Таймаут')) {
                        throw e;
                    }
                } finally {
                    // Убеждаемся, что обработчик удален
                    if (abortHandler) {
                        eventSource.off(event_types.GENERATION_AFTER_COMMANDS, abortHandler);
                    }
                }
                
                // Сохраняем кеш для персонажа
                const saved = await saveCharacterCache(normalizedName, slotIndex);
                
                if (saved) {
                    preloadedCount++;
                    console.debug(`[KV Cache Manager] Кеш для персонажа ${characterName} успешно предзагружен`);
                } else {
                    errors.push(`${characterName}: ошибка сохранения кеша`);
                }
                
            } catch (e) {
                console.error(`[KV Cache Manager] Ошибка при предзагрузке для персонажа ${characterName}:`, e);
                errors.push(`${characterName}: ${e.message || 'Неизвестная ошибка'}`);
            }
        }
        
        // Показываем результат
        if (preloadedCount > 0) {
            if (errors.length > 0) {
                showToast('warning', `Предзагружено ${preloadedCount} из ${characters.length} персонажей. Ошибки: ${errors.join(', ')}`, 'Предзагрузка');
            } else {
                showToast('success', `Успешно предзагружено ${preloadedCount} персонажей`, 'Предзагрузка');
            }
            
            // Обновляем список слотов
            setTimeout(() => updateSlotsList(), 1000);
            
            return true;
        } else {
            showToast('error', `Не удалось предзагрузить кеши. Ошибки: ${errors.join(', ')}`, 'Предзагрузка');
            return false;
        }
        
    } finally {
        // Выключаем режим предзагрузки
        setPreloadingMode(false);
        
        // Включаем кнопки сохранения
        enableAllSaveButtons();
    }
}
