// UI компоненты и уведомления для KV Cache Manager

import { getContext } from "../../../../extensions.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../../scripts/popup.js';

import { getExtensionSettings } from '../settings.js';
import { getSlotsState, initializeSlots } from '../core/slot-manager.js';
import { saveCache, saveCharacterCache } from '../core/cache-operations.js';
import { preloadCharactersCache } from './preload-cache.js';
import { openLoadPopup } from './load-popup.js';
import { openPreloadPopup } from './preload-popup.js';

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
            // Обновляем отображение слотов после сохранения
            const { updateSlotsList } = await import('../core/slot-manager.js');
            updateSlotsList();
        }
    } finally {
        enableAllSaveButtons();
    }
}

export async function onLoadButtonClick() {
    await openLoadPopup();
}

export async function onReleaseAllSlotsButtonClick() {
    // Показываем попап подтверждения
    const confirmationMessage = '<p style="margin: 10px 0; font-size: 14px;">Вы уверены, что хотите очистить все слоты?</p><p style="margin: 10px 0; font-size: 12px; color: var(--SmartThemeBodyColor, #888);">Все данные в слотах будут удалены.</p>';
    
    const result = await callGenericPopup(
        confirmationMessage,
        POPUP_TYPE.TEXT,
        '',
        {
            okButton: 'Очистить',
            cancelButton: true,
            wide: false
        }
    );
    
    // Выполняем очистку только если пользователь подтвердил
    if (result === POPUP_RESULT.AFFIRMATIVE) {
        await initializeSlots();
        showToast('success', 'Все слоты освобождены', 'Режим групповых чатов');
    }
}

// Обработчик кнопки предзагрузки персонажей
export async function onPreloadCharactersButtonClick() {
    // Проверяем, что чат групповой
    const context = getContext();
    if (!context || context.groupId === null || context.groupId === undefined) {
        showToast('error', 'Предзагрузка доступна только для групповых чатов');
        return;
    }
    
    // Открываем popup для выбора персонажей
    const selectedCharacters = await openPreloadPopup();
    
    if (!selectedCharacters || selectedCharacters.length === 0) {
        // Пользователь отменил выбор или не выбрал персонажей
        return;
    }
    
    // Запускаем предзагрузку
    await preloadCharactersCache(selectedCharacters);
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
