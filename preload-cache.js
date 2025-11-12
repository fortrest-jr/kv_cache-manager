// Предзагрузка кеша для персонажей

import { getContext } from "../../../extensions.js";
import { eventSource, event_types, generateQuietPrompt } from "../../../../script.js";
import { acquireSlot, updateSlotsList } from './slot-manager.js';
import { saveCharacterCache } from './cache-operations.js';
import { showToast, disableAllSaveButtons, enableAllSaveButtons } from './ui.js';
import { setPreloadingMode } from './generation-interceptor.js';

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

