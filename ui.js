// UI компоненты и уведомления для KV Cache Manager

import { getExtensionSettings } from './settings.js';
import { getNormalizedChatId } from './utils.js';
import { getSlotsState, initializeSlots } from './slot-manager.js';
import { saveCache, saveCharacterCache } from './cache-operations.js';
import { openLoadModal } from './load-modal.js';
import { updateNextSaveIndicator, resetChatCounters } from './auto-save.js';

// Показ toast-уведомления
export function showToast(type, message, title = 'KV Cache Manager') {
    const extensionSettings = getExtensionSettings();
    
    if (typeof toastr === 'undefined') {
        console.debug(`[KV Cache Manager] ${title}: ${message}`);
        return;
    }

    if (!extensionSettings.showNotifications) {
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

// Отключение всех кнопок сохранения
export function disableAllSaveButtons() {
    $("#kv-cache-save-button").prop('disabled', true);
    $("#kv-cache-save-now-button").prop('disabled', true);
    $(".kv-cache-save-slot-button").prop('disabled', true);
}

// Включение всех кнопок сохранения
export function enableAllSaveButtons() {
    $("#kv-cache-save-button").prop('disabled', false);
    $("#kv-cache-save-now-button").prop('disabled', false);
    $(".kv-cache-save-slot-button").prop('disabled', false);
}

// Обработчики для кнопок
export async function onSaveButtonClick() {
    disableAllSaveButtons();
    try {
        await saveCache(true);
    } finally {
        enableAllSaveButtons();
    }
}

export async function onSaveNowButtonClick() {
    disableAllSaveButtons();
    try {
        const success = await saveCache(false);
        if (success) {
            // Сбрасываем счётчики всех персонажей текущего чата после успешного сохранения
            const chatId = getNormalizedChatId();
            resetChatCounters(chatId);
            updateNextSaveIndicator();
        }
    } finally {
        enableAllSaveButtons();
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
