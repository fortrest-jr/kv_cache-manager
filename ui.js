// UI компоненты и уведомления для KV Cache Manager

import { getExtensionSettings } from './settings.js';
import { getNormalizedChatId } from './utils.js';
import { getSlotsState, initializeSlots } from './slot-manager.js';
import { saveCache, saveCharacterCache } from './cache-operations.js';
import { openLoadModal } from './load-modal.js';
import { updateNextSaveIndicator, resetChatCounters } from './auto-save.js';

// Показ toast-уведомления
export function showToast(type, message, title = 'KV Cache Manager', force = false) {
    const extensionSettings = getExtensionSettings();
    
    // Всегда логируем в консоль для отладки
    const logLevel = type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'log';
    console[logLevel](`[KV Cache Manager] ${title}: ${message}`);
    
    if (typeof toastr === 'undefined') {
        // Если toastr не определен, пытаемся показать через alert для критических ошибок
        if (type === 'error' && force) {
            alert(`[KV Cache Manager] ${title}: ${message}`);
        }
        return;
    }

    // Если не принудительный показ, проверяем настройки
    if (!force && !extensionSettings.showNotifications) {
        return;
    }

    switch (type) {
        case 'success':
            toastr.success(message, title);
            break;
        case 'error':
            toastr.error(message, title);
            break;
        case 'warning':
            toastr.warning(message, title);
            break;
        case 'info':
        default:
            toastr.info(message, title);
            break;
    }
}

// Обработчики для кнопок
export async function onSaveButtonClick() {
    await saveCache(true);
}

export async function onSaveNowButtonClick() {
    const success = await saveCache(false);
    if (success) {
        // Сбрасываем счётчики всех персонажей текущего чата после успешного сохранения
        const chatId = getNormalizedChatId();
        resetChatCounters(chatId);
        updateNextSaveIndicator();
    }
}

export async function onLoadButtonClick() {
    await openLoadModal();
}

export async function onReleaseAllSlotsButtonClick() {
    await initializeSlots();
    showToast('success', 'Все слоты освобождены', 'Режим групповых чатов');
}

// Сохранение кеша для конкретного слота
export async function onSaveSlotButtonClick(event) {
    const button = $(event.target).closest('.kv-cache-save-slot-button');
    const slotIndex = parseInt(button.data('slot-index'));
    const characterName = button.data('character-name');
    
    if (isNaN(slotIndex) || !characterName) {
        showToast('error', 'Ошибка: неверные данные слота', 'Сохранение слота');
        return;
    }
    
    // Проверяем, что слот действительно занят этим персонажем
    // characterName из data-атрибута уже нормализован (хранится в slotsState)
    const slotsState = getSlotsState();
    const slot = slotsState[slotIndex];
    if (!slot || !slot.characterName || slot.characterName !== characterName) {
        showToast('error', 'Персонаж не найден в этом слоте', 'Сохранение слота');
        return;
    }
    
    // Временно отключаем кнопку
    button.prop('disabled', true);
    const originalTitle = button.attr('title');
    button.attr('title', 'Сохранение...');
    
    try {
        showToast('info', `Сохранение кеша для ${characterName}...`, 'Сохранение слота');
        const success = await saveCharacterCache(characterName, slotIndex);
        
        if (success) {
            showToast('success', `Кеш для ${characterName} успешно сохранен`, 'Сохранение слота');
        } else {
            showToast('error', `Не удалось сохранить кеш для ${characterName}`, 'Сохранение слота');
        }
    } catch (e) {
        console.error(`[KV Cache Manager] Ошибка при сохранении слота ${slotIndex}:`, e);
        showToast('error', `Ошибка при сохранении: ${e.message}`, 'Сохранение слота');
    } finally {
        // Включаем кнопку обратно
        button.prop('disabled', false);
        button.attr('title', originalTitle);
    }
}
