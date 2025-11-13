// Автосохранение для KV Cache Manager

import { getSlotsState, findCharacterSlotIndex, incrementSlotUsage } from './slot-manager.js';
import { saveCharacterCache } from './cache-operations.js';
import { getExtensionSettings } from './settings.js';
import { getNormalizedCharacterNameFromData } from './generation-interceptor.js';

// Проверка необходимости автосохранения и выполнение сохранения
// @param {number} slotIndex - Индекс слота
// @param {number} currentUsage - Текущее значение usage
async function checkAndPerformAutoSave(slotIndex, currentUsage) {
    const extensionSettings = getExtensionSettings();
    const interval = extensionSettings.saveInterval;
    
    if (currentUsage < interval) {
        return;
    }
    
    const slotsState = getSlotsState();
    const slot = slotsState[slotIndex];
    const characterName = slot?.characterName;
    
    if (!characterName) {
        return;
    }
    
    // Запускаем автосохранение
    // usage сбрасывается автоматически в saveCharacterCache после успешного сохранения
    try {
        const success = await saveCharacterCache(characterName, slotIndex);
        if (success) {
            // Обновляем отображение
            const { updateSlotsList } = await import('./slot-manager.js');
            updateSlotsList();
        }
    } catch (e) {
        // При ошибке не сбрасываем usage, чтобы попробовать сохранить снова
        console.error(`[KV Cache Manager] Ошибка при автосохранении кеша для персонажа ${characterName}:`, e);
    }
}

// Обработка события получения сообщения для автосохранения
// Увеличивает usage слота и проверяет необходимость автосохранения
// Увеличивается только для normal генерации или если usage === 0
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
    
    // Находим слот персонажа
    const slotIndex = findCharacterSlotIndex(characterName);
    if (slotIndex === null) {
        return; // Персонаж не в слоте
    }
    
    const slotsState = getSlotsState();
    const slot = slotsState[slotIndex];
    const generationType = slot?.generationType;
    
    // Увеличиваем usage только для normal или если usage === 0
    const shouldIncrement = (generationType === 'normal') || (slot?.usage === 0);
    
    if (shouldIncrement) {
        incrementSlotUsage(slotIndex);
        const newUsage = slot.usage;
        
        console.debug(`[KV Cache Manager] Usage для персонажа ${characterName} в слоте ${slotIndex} увеличен до: ${newUsage} (тип: ${generationType})`);
        
        // Проверяем необходимость автосохранения
        await checkAndPerformAutoSave(slotIndex, newUsage);
        
        // Обновляем отображение
        const { updateSlotsList } = await import('./slot-manager.js');
        updateSlotsList();
    } else {
        console.debug(`[KV Cache Manager] Usage для персонажа ${characterName} в слоте ${slotIndex} не увеличен (тип: ${generationType}, текущее значение: ${slot?.usage})`);
    }
    
    // Очищаем тип генерации после обработки
    slot.generationType = null;
}
