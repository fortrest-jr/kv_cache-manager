// Предзагрузка кеша для персонажей

import { getContext } from "../../../../extensions.js";
import { generateQuietPrompt } from "../../../../../script.js";

import { saveCharacterCache } from '../core/cache-operations.js';
import { showToast, disableAllSaveButtons, enableAllSaveButtons } from './ui.js';
import { setPreloadingMode, setCurrentPreloadCharacter, getCurrentSlot } from '../interceptors/generation-interceptor.js';
import { createHiddenMessage, editMessageUsingUpdate } from './hidden-message.js';
import { getExtensionSettings } from '../settings.js';

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
        const context = getContext();
        return context.stopGeneration();
    };
    
    // Функция для обработки отмены
    const handleCancel = () => {
        if (isCancelled) {
            return; // Уже отменено
        }
        
        isCancelled = true;
        
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
        // Создаем начальное сообщение
        const initialStatus = formatPreloadStatus(0, characters.length, [], [], null, null, false, null);
        statusMessageId = await createHiddenMessage(initialStatus, true);
        
        // Устанавливаем обработчик для кнопки отмены после небольшой задержки (чтобы DOM успел обновиться)
        setTimeout(() => {
            const cancelButton = $(`#kv-cache-preload-cancel-btn-${statusMessageId}`);
            if (cancelButton.length > 0) {
                cancelButton.off('click').on('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCancel();
                });
            }
        }, 500);
        
        // Обрабатываем каждого персонажа последовательно
        for (let i = 0; i < characters.length; i++) {
            // Проверяем флаг отмены
            if (isCancelled) {
                break;
            }
            
            const character = characters[i];
            const characterName = character.name;
            const normalizedName = character.normalizedName;
            const characterId = character.characterId;
            
            if (!characterId) {
                console.error(`[KV Cache Manager] [${characterName}] Не найден ID персонажа`);
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
                // Проверяем флаг отмены перед началом обработки
                if (isCancelled) {
                    break;
                }
                
                // Обновляем статус перед началом обработки персонажа
                if (statusMessageId !== null) {
                    const status = formatPreloadStatus(i, characters.length, preloaded, errors, characterName, null, isCancelled, statusMessageId);
                    await editMessageUsingUpdate(statusMessageId, status);
                    // Обновляем обработчик кнопки отмены
                    updateCancelButtonHandler(statusMessageId, handleCancel);
                }
                
                // Получаем таймаут из настроек (в минутах, конвертируем в миллисекунды)
                const extensionSettings = getExtensionSettings();
                const timeoutMinutes = extensionSettings.preloadTimeout;
                const timeoutMs = timeoutMinutes * 60 * 1000;
                
                try {
                    // Проверяем флаг отмены перед запуском генерации
                    if (isCancelled) {
                        break;
                    }
                    
                    // Устанавливаем текущего персонажа для перехватчика генерации
                    // Это нужно, т.к. контекст может быть еще не обновлен после forceChId
                    setCurrentPreloadCharacter(normalizedName);
                    
                    // generateQuietPrompt возвращает промис
                    currentGenerationTask = generateQuietPrompt({
                        forceChId: Number(characterId),
                        responseLength: 1
                    });
                    
                    // Создаем промис с таймаутом для ожидания генерации
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => {
                            reject(new Error(`Таймаут ожидания генерации (${timeoutMinutes} минут)`));
                        }, timeoutMs);
                    });
                    
                    // Проверяем флаг отмены во время ожидания
                    let cancelCheckInterval = null;
                    const cancelCheckPromise = new Promise((resolve) => {
                        cancelCheckInterval = setInterval(() => {
                            if (isCancelled) {
                                clearInterval(cancelCheckInterval);
                                // Останавливаем генерацию
                                stopGeneration(currentGenerationTask);
                                resolve('cancelled');
                            }
                        }, 100);
                    });
                    
                    try {
                        const result = await Promise.race([
                            currentGenerationTask.then(() => {
                                // Очищаем интервал при нормальном завершении
                                if (cancelCheckInterval) {
                                    clearInterval(cancelCheckInterval);
                                }
                                return 'completed';
                            }).catch((e) => {
                                console.error(`[KV Cache Manager] [${characterName}] Генерация завершена с ошибкой:`, e);
                                // Очищаем интервал при ошибке
                                if (cancelCheckInterval) {
                                    clearInterval(cancelCheckInterval);
                                }
                                throw e;
                            }),
                            timeoutPromise.catch((e) => {
                                // Очищаем интервал при таймауте
                                if (cancelCheckInterval) {
                                    clearInterval(cancelCheckInterval);
                                }
                                throw e;
                            }),
                            cancelCheckPromise.then((result) => {
                                return result;
                            })
                        ]);
                        
                        // Проверяем флаг отмены после генерации
                        if (isCancelled || result === 'cancelled') {
                            // Дополнительная попытка остановить генерацию
                            stopGeneration(currentGenerationTask);
                            break;
                        }
                        
                        // Останавливаем генерацию после завершения
                        stopGeneration(currentGenerationTask);
                    } catch (e) {
                        // Очищаем интервал при ошибке
                        if (cancelCheckInterval) {
                            clearInterval(cancelCheckInterval);
                        }
                        throw e;
                    }
                    
                } catch (e) {
                    // Если ошибка связана с остановкой генерации - это нормально
                    const isAbortError = e.message && (e.message.includes('aborted') || e.message.includes('AbortError') || e.message.includes('cancelled'));
                    const isTimeout = e.message && e.message.includes('Таймаут');
                    
                    if (!isAbortError && !isTimeout) {
                        console.error(`[KV Cache Manager] [${characterName}] Исключение в блоке генерации:`, e);
                        throw e;
                    }
                } finally {
                    // Очищаем текущего персонажа для предзагрузки
                    setCurrentPreloadCharacter(null);
                    // Сбрасываем ссылку на задачу генерации
                    currentGenerationTask = null;
                }
                
                // Получаем слот из перехватчика (он был установлен при генерации)
                const slotIndex = getCurrentSlot();
                
                if (slotIndex !== null) {
                    // Сохраняем кеш для персонажа
                    const saved = await saveCharacterCache(normalizedName, slotIndex);
                    
                    if (saved) {
                        preloaded.push(characterName);
                    } else {
                        console.error(`[KV Cache Manager] [${characterName}] Ошибка сохранения кеша`);
                        errors.push(`${characterName}: ошибка сохранения кеша`);
                    }
                }
                
                // Проверяем флаг отмены после обработки
                if (isCancelled) {
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
                    await editMessageUsingUpdate(statusMessageId, status);
                    // Обновляем обработчик кнопки отмены
                    updateCancelButtonHandler(statusMessageId, handleCancel);
                }
                
            } catch (e) {
                console.error(`[KV Cache Manager] Ошибка при предзагрузке для персонажа ${characterName}:`, e);
                errors.push(`${characterName}: ${e.message || 'Неизвестная ошибка'}`);
                
                // Обновляем статус при ошибке
                if (statusMessageId !== null) {
                    // Показываем имя следующего персонажа, если он есть
                    const nextCharacterName = i + 1 < characters.length ? characters[i + 1].name : null;
                    const status = formatPreloadStatus(i + 1, characters.length, preloaded, errors, nextCharacterName, null, isCancelled, statusMessageId);
                    await editMessageUsingUpdate(statusMessageId, status);
                    // Обновляем обработчик кнопки отмены
                    updateCancelButtonHandler(statusMessageId, handleCancel);
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
            await editMessageUsingUpdate(statusMessageId, finalStatus);
        }
        
        // Показываем финальный тост
        if (preloaded.length > 0) {
            if (errors.length > 0) {
                showToast('warning', `Предзагружено ${preloaded.length} из ${characters.length} персонажей. Ошибки: ${errors.length}`, 'Предзагрузка');
            } else {
                showToast('success', `Успешно предзагружено ${preloaded.length} персонажей`, 'Предзагрузка');
            }
            
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

