// Предзагрузка кеша для персонажей

import { getContext } from "../../../extensions.js";
import { eventSource, event_types, generateQuietPrompt } from "../../../../script.js";
import { acquireSlot, updateSlotsList } from './slot-manager.js';
import { saveCharacterCache } from './cache-operations.js';
import { showToast, disableAllSaveButtons, enableAllSaveButtons } from './ui.js';
import { setPreloadingMode } from './generation-interceptor.js';
import { createHiddenMessage, editMessageUsingUpdate } from './hidden-message.js';

// Обновление обработчика кнопки отмены
function updateCancelButtonHandler(messageId, handleCancel) {
    setTimeout(() => {
        const cancelButton = $(`#kv-cache-preload-cancel-btn-${messageId}`);
        if (cancelButton.length > 0) {
            cancelButton.off('click').on('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                handleCancel();
            });
        }
    }, 100);
}

// Формирование текста статуса предзагрузки
function formatPreloadStatus(current, total, preloaded, errors, currentCharacterName = null, currentSlotIndex = null, isCancelled = false, messageId = null) {
    const remaining = total - current;
    const progress = total > 0 ? Math.round((current / total) * 100) : 0;
    
    // Формируем статус в markdown формате
    let status = `**Предзагрузка кеша**\n\n`;
    
    if (isCancelled) {
        status += `⚠️ **Отменено**\n\n`;
    } else {
        // Добавляем имя текущего прогреваемого персонажа и слот, если указано
        if (currentCharacterName) {
            if (currentSlotIndex !== null && currentSlotIndex !== undefined) {
                status += `Прогревается: **${currentCharacterName}** (слот ${currentSlotIndex})\n\n`;
            } else {
                status += `Прогревается: **${currentCharacterName}**\n\n`;
            }
        }
    }
    
    status += `Прогресс: ${current}/${total} (${progress}%)\n`;
    status += `Прогрето: ${preloaded.length}\n`;
    status += `Осталось: ${remaining}\n`;
    
    if (preloaded.length > 0) {
        status += `\n**Прогретые персонажи:**\n`;
        preloaded.forEach((name, idx) => {
            status += `${idx + 1}. ${name}\n`;
        });
    }
    
    if (errors.length > 0) {
        status += `\n**Ошибки:**\n`;
        errors.forEach((error, idx) => {
            status += `${idx + 1}. ${error}\n`;
        });
    }
    
    // Добавляем кнопку отмены, если процесс не завершен и не отменен
    if (!isCancelled && current < total && messageId !== null) {
        status += `\n\n<button id="kv-cache-preload-cancel-btn-${messageId}" class="menu_button" type="button">Отменить</button>`;
    }
    
    return status;
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
    
    // Создаем скрытое сообщение для отслеживания прогресса
    let statusMessageId = null;
    const preloaded = [];
    const errors = [];
    let isCancelled = false;
    let currentGenerationTask = null;
    
    // Функция для остановки генерации
    const stopGeneration = (generationTask = null) => {
        const task = generationTask || currentGenerationTask;
        
        // Пытаемся остановить через cancel метода задачи генерации
        if (task && typeof task.cancel === 'function') {
            try {
                task.cancel();
                console.debug('[KV Cache Manager] Генерация остановлена через generationTask.cancel()');
            } catch (e) {
                console.warn('[KV Cache Manager] Ошибка при вызове generationTask.cancel():', e);
            }
        }
        
        // Пытаемся остановить через abortController
        if (typeof getAbortController === 'function') {
            try {
                const controller = getAbortController();
                if (controller) {
                    controller.abort();
                    console.debug('[KV Cache Manager] Генерация остановлена через abortController');
                }
            } catch (e) {
                console.warn('[KV Cache Manager] Ошибка при вызове abortController.abort():', e);
            }
        }
        
        // Альтернативный способ остановки генерации
        if (typeof abortGeneration === 'function') {
            try {
                abortGeneration();
                console.debug('[KV Cache Manager] Генерация остановлена через abortGeneration()');
            } catch (e) {
                console.warn('[KV Cache Manager] Ошибка при вызове abortGeneration():', e);
            }
        }
    };
    
    // Функция для обработки отмены
    const handleCancel = () => {
        if (isCancelled) {
            return; // Уже отменено
        }
        
        isCancelled = true;
        console.debug('[KV Cache Manager] Предзагрузка отменена пользователем');
        
        // Останавливаем текущую генерацию
        stopGeneration();
        
        if (statusMessageId !== null) {
            const status = formatPreloadStatus(
                preloaded.length, 
                characters.length, 
                preloaded, 
                [...errors, 'Отменено пользователем'], 
                null, 
                null, 
                true, 
                statusMessageId
            );
            editMessageUsingUpdate(statusMessageId, status);
        }
    };
    
    try {
        console.debug('[KV Cache Manager] Начало предзагрузки:', {
            totalCharacters: characters.length,
            characters: characters.map(c => ({ name: c.name, normalizedName: c.normalizedName, isMuted: c.isMuted }))
        });
        
        // Создаем начальное сообщение
        const initialStatus = formatPreloadStatus(0, characters.length, [], [], null, null, false, null);
        console.debug('[KV Cache Manager] Создание начального сообщения статуса...');
        statusMessageId = await createHiddenMessage(initialStatus, true);
        console.debug('[KV Cache Manager] Сообщение статуса создано, ID:', statusMessageId);
        
        // Устанавливаем обработчик для кнопки отмены после небольшой задержки (чтобы DOM успел обновиться)
        setTimeout(() => {
            const cancelButton = $(`#kv-cache-preload-cancel-btn-${statusMessageId}`);
            if (cancelButton.length > 0) {
                cancelButton.off('click').on('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCancel();
                });
                console.debug('[KV Cache Manager] Обработчик кнопки отмены установлен');
            }
        }, 500);
        
        // Обрабатываем каждого персонажа последовательно
        for (let i = 0; i < characters.length; i++) {
            // Проверяем флаг отмены
            if (isCancelled) {
                console.debug('[KV Cache Manager] Предзагрузка отменена, прерываем цикл');
                break;
            }
            
            const character = characters[i];
            const characterName = character.name;
            const normalizedName = character.normalizedName;
            const characterId = character.characterId;
            
            if (!characterId) {
                errors.push(`${characterName}: не найден ID персонажа`);
                // Обновляем статус
                if (statusMessageId !== null) {
                    const status = formatPreloadStatus(i + 1, characters.length, preloaded, errors, characterName, null, isCancelled, statusMessageId);
                    await editMessageUsingUpdate(statusMessageId, status);
                    // Обновляем обработчик кнопки отмены
                    updateCancelButtonHandler(statusMessageId, handleCancel);
                }
                continue;
            }
            
            try {
                // Получаем/занимаем слот для персонажа
                const slotIndex = await acquireSlot(normalizedName, 0); // Не сохраняем при вытеснении во время предзагрузки
                
                if (slotIndex === null) {
                    errors.push(`${characterName}: не удалось получить слот`);
                    // Обновляем статус при ошибке получения слота
                    if (statusMessageId !== null) {
                        const status = formatPreloadStatus(i + 1, characters.length, preloaded, errors, characterName, null);
                        await editMessageUsingUpdate(statusMessageId, status);
                    }
                    continue;
                }
                
                console.debug(`[KV Cache Manager] Предзагрузка для персонажа ${characterName} в слот ${slotIndex}`);
                
                // Проверяем флаг отмены перед началом обработки
                if (isCancelled) {
                    console.debug('[KV Cache Manager] Предзагрузка отменена перед обработкой персонажа');
                    break;
                }
                
                // Обновляем статус после получения слота (перед началом обработки персонажа)
                if (statusMessageId !== null) {
                    const status = formatPreloadStatus(i, characters.length, preloaded, errors, characterName, slotIndex, isCancelled, statusMessageId);
                    console.debug(`[KV Cache Manager] Обновление статуса перед персонажем ${i + 1}/${characters.length}:`, { characterName, slotIndex, statusMessageId });
                    await editMessageUsingUpdate(statusMessageId, status);
                    // Обновляем обработчик кнопки отмены
                    updateCancelButtonHandler(statusMessageId, handleCancel);
                    console.debug(`[KV Cache Manager] Статус обновлен для персонажа ${characterName}`);
                }
                
                // Создаем Promise для ожидания события GENERATION_AFTER_COMMANDS
                let generationStarted = false;
                let abortHandler = null;
                
                const generationPromise = new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        if (!generationStarted) {
                            // Отписываемся от события при таймауте
                            if (abortHandler) {
                                eventSource.removeListener(event_types.GENERATION_AFTER_COMMANDS, abortHandler);
                            }
                            reject(new Error('Таймаут ожидания начала генерации'));
                        }
                    }, 30000); // 30 секунд таймаут
                    
                    // Создаем обработчик и сохраняем ссылку на него
                    const handler = () => {
                        // Проверяем флаг отмены
                        if (isCancelled) {
                            clearTimeout(timeout);
                            eventSource.removeListener(event_types.GENERATION_AFTER_COMMANDS, handler);
                            // Останавливаем генерацию при отмене
                            stopGeneration(currentGenerationTask);
                            reject(new Error('Отменено пользователем'));
                            return;
                        }
                        
                        // Проверяем, что обработчик еще не был вызван
                        if (generationStarted) {
                            return;
                        }
                        
                        generationStarted = true;
                        clearTimeout(timeout);
                        
                        // Отписываемся от события (передаем ту же функцию, что использовалась при подписке)
                        eventSource.removeListener(event_types.GENERATION_AFTER_COMMANDS, handler);
                        
                        // Останавливаем генерацию после обработки промпта
                        stopGeneration(currentGenerationTask);
                        console.debug(`[KV Cache Manager] Генерация для ${characterName} остановлена после обработки промпта`);
                        
                        resolve();
                    };
                    
                    // Сохраняем ссылку на обработчик для возможности отписки
                    abortHandler = handler;
                    
                    // Подписываемся на событие
                    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, handler);
                });
                
                try {
                    // Проверяем флаг отмены перед запуском генерации
                    if (isCancelled) {
                        console.debug('[KV Cache Manager] Предзагрузка отменена перед запуском генерации');
                        break;
                    }
                    
                    // Запускаем генерацию через generateQuietPrompt
                    // generateQuietPrompt возвращает промис
                    currentGenerationTask = generateQuietPrompt({
                        quietPrompt: '',
                        forceChId: characterId,
                        quietToLoud: false,
                        responseLength: 10
                    });
                    
                    // Ждем события GENERATION_AFTER_COMMANDS (это произойдет раньше, чем завершится генерация)
                    // Проверяем флаг отмены во время ожидания
                    let cancelCheckInterval = null;
                    const cancelCheckPromise = new Promise((resolve) => {
                        cancelCheckInterval = setInterval(() => {
                            if (isCancelled) {
                                clearInterval(cancelCheckInterval);
                                // Отписываемся от события при отмене
                                if (abortHandler) {
                                    eventSource.removeListener(event_types.GENERATION_AFTER_COMMANDS, abortHandler);
                                }
                                // Останавливаем генерацию
                                stopGeneration(currentGenerationTask);
                                resolve('cancelled');
                            }
                        }, 100);
                    });
                    
                    const result = await Promise.race([
                        generationPromise.then(() => {
                            // Очищаем интервал при нормальном завершении
                            if (cancelCheckInterval) {
                                clearInterval(cancelCheckInterval);
                            }
                            return 'completed';
                        }),
                        cancelCheckPromise
                    ]);
                    
                    // Проверяем флаг отмены после генерации
                    if (isCancelled || result === 'cancelled') {
                        console.debug('[KV Cache Manager] Предзагрузка отменена после генерации');
                        // Дополнительная попытка остановить генерацию
                        stopGeneration(currentGenerationTask);
                        break;
                    }
                    
                    // Останавливаем генерацию после обработки промпта
                    stopGeneration(currentGenerationTask);
                    
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
                    // Убеждаемся, что обработчик удален (передаем ту же функцию, что использовалась при подписке)
                    if (abortHandler && !generationStarted) {
                        eventSource.removeListener(event_types.GENERATION_AFTER_COMMANDS, abortHandler);
                    }
                    // Сбрасываем ссылку на задачу генерации
                    currentGenerationTask = null;
                }
                
                // Сохраняем кеш для персонажа
                const saved = await saveCharacterCache(normalizedName, slotIndex);
                
                if (saved) {
                    preloaded.push(characterName);
                    console.debug(`[KV Cache Manager] Кеш для персонажа ${characterName} успешно предзагружен`);
                } else {
                    errors.push(`${characterName}: ошибка сохранения кеша`);
                }
                
                // Проверяем флаг отмены после обработки
                if (isCancelled) {
                    console.debug('[KV Cache Manager] Предзагрузка отменена после обработки персонажа');
                    break;
                }
                
                // Обновляем статус после обработки персонажа
                if (statusMessageId !== null) {
                    // Показываем имя следующего персонажа и его слот, если он есть
                    let nextCharacterName = null;
                    let nextSlotIndex = null;
                    if (i + 1 < characters.length) {
                        nextCharacterName = characters[i + 1].name;
                        // Слот для следующего персонажа еще не получен, поэтому null
                    }
                    const status = formatPreloadStatus(i + 1, characters.length, preloaded, errors, nextCharacterName, nextSlotIndex, isCancelled, statusMessageId);
                    console.debug(`[KV Cache Manager] Обновление статуса после персонажа ${i + 1}/${characters.length}:`, { characterName, statusMessageId, saved });
                    await editMessageUsingUpdate(statusMessageId, status);
                    // Обновляем обработчик кнопки отмены
                    updateCancelButtonHandler(statusMessageId, handleCancel);
                    console.debug(`[KV Cache Manager] Статус обновлен после обработки ${characterName}`);
                }
                
            } catch (e) {
                console.error(`[KV Cache Manager] Ошибка при предзагрузке для персонажа ${characterName}:`, e);
                errors.push(`${characterName}: ${e.message || 'Неизвестная ошибка'}`);
                
                // Обновляем статус при ошибке
                if (statusMessageId !== null) {
                    // Показываем имя следующего персонажа, если он есть
                    const nextCharacterName = i + 1 < characters.length ? characters[i + 1].name : null;
                    const status = formatPreloadStatus(i + 1, characters.length, preloaded, errors, nextCharacterName, null, isCancelled, statusMessageId);
                    console.debug(`[KV Cache Manager] Обновление статуса при ошибке для персонажа ${i + 1}/${characters.length}:`, { characterName, statusMessageId, error: e.message });
                    await editMessageUsingUpdate(statusMessageId, status);
                    // Обновляем обработчик кнопки отмены
                    updateCancelButtonHandler(statusMessageId, handleCancel);
                    console.debug(`[KV Cache Manager] Статус обновлен после ошибки для ${characterName}`);
                }
            }
        }
        
        // Финальное обновление статуса
        if (statusMessageId !== null) {
            const finalStatus = formatPreloadStatus(
                isCancelled ? preloaded.length : characters.length, 
                characters.length, 
                preloaded, 
                errors, 
                null, 
                null, 
                isCancelled, 
                statusMessageId
            );
            console.debug('[KV Cache Manager] Финальное обновление статуса:', { statusMessageId, preloadedCount: preloaded.length, errorsCount: errors.length, isCancelled });
            await editMessageUsingUpdate(statusMessageId, finalStatus);
            console.debug('[KV Cache Manager] Финальный статус обновлен');
        } else {
            console.warn('[KV Cache Manager] statusMessageId равен null, финальное обновление не выполнено');
        }
        
        // Показываем финальный тост
        if (preloaded.length > 0) {
            if (errors.length > 0) {
                showToast('warning', `Предзагружено ${preloaded.length} из ${characters.length} персонажей. Ошибки: ${errors.length}`, 'Предзагрузка');
            } else {
                showToast('success', `Успешно предзагружено ${preloaded.length} персонажей`, 'Предзагрузка');
            }
            
            // Обновляем список слотов
            setTimeout(() => updateSlotsList(), 1000);
            
            return true;
        } else {
            showToast('error', `Не удалось предзагрузить кеши. Ошибки: ${errors.length}`, 'Предзагрузка');
            return false;
        }
        
    } finally {
        // Выключаем режим предзагрузки
        setPreloadingMode(false);
        
        // Включаем кнопки сохранения
        enableAllSaveButtons();
    }
}

