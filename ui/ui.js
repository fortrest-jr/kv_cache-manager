import { getContext } from "../../../../extensions.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../../scripts/popup.js';
import { t } from '../../../../i18n.js';

import { getExtensionSettings } from '../settings.js';
import { getSlotsState, initializeSlots } from '../core/slot-manager.js';
import { saveCache, saveCharacterCache } from '../core/cache-operations.js';
import { preloadCharactersCache } from './preload-cache.js';
import { openLoadPopup } from './load-popup.js';
import { openPreloadPopup } from './preload-popup.js';

export function showToast(type, message, title = 'KV Cache Manager') {
    const extensionSettings = getExtensionSettings();
    
    if (typeof toastr === 'undefined') {
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

export function disableAllSaveButtons() {
    $("#kv-cache-save-button").prop('disabled', true);
    $("#kv-cache-save-now-button").prop('disabled', true);
    $(".kv-cache-save-slot-button").prop('disabled', true);
}

export function enableAllSaveButtons() {
    $("#kv-cache-save-button").prop('disabled', false);
    $("#kv-cache-save-now-button").prop('disabled', false);
    $(".kv-cache-save-slot-button").prop('disabled', false);
}

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
    const confirmationMessage = `<p style="margin: 10px 0; font-size: 14px;">${t`Are you sure you want to clear all slots?`}</p><p style="margin: 10px 0; font-size: 12px; color: var(--SmartThemeBodyColor, #888);">${t`All data in slots will be deleted.`}</p>`;
    
    const result = await callGenericPopup(
        confirmationMessage,
        POPUP_TYPE.TEXT,
        '',
        {
            okButton: t`Clear`,
            cancelButton: true,
            wide: false
        }
    );
    
    if (result === POPUP_RESULT.AFFIRMATIVE) {
        await initializeSlots();
        showToast('success', t`All slots cleared`, t`Group Chat Mode`);
    }
}

export async function onPreloadCharactersButtonClick() {
    const context = getContext();
    if (!context || context.groupId === null || context.groupId === undefined) {
        showToast('error', t`Preload is only available for group chats`);
        return;
    }
    
    const selectedCharacters = await openPreloadPopup();
    
    if (!selectedCharacters || selectedCharacters.length === 0) {
        return;
    }
    
    await preloadCharactersCache(selectedCharacters);
}

export async function showTagInputPopup() {
    const tagInputHTML = `
        <div style="padding: 10px;">
            <label for="kv-cache-tag-input" style="display: block; margin-bottom: 8px;">${t`Enter tag for saving`}:</label>
            <input 
                type="text" 
                id="kv-cache-tag-input" 
                class="text_pole"
                placeholder="${t`Enter tag for saving`}"
                autofocus
            />
        </div>
    `;
    
    let tagValue = null;
    
    const result = await callGenericPopup(
        tagInputHTML,
        POPUP_TYPE.TEXT,
        '',
        {
            okButton: t`Save`,
            cancelButton: true,
            wide: false,
            onOpen: async (popup) => {
                await new Promise(resolve => setTimeout(resolve, 100));
                
                const $input = $(popup.content).find('#kv-cache-tag-input');
                const okButton = popup.okButton;
                okButton.setAttribute('disabled', 'true');
                
                const updateButtonState = () => {
                    const value = $input.val()?.trim() || '';
                    if (value) {
                        okButton.removeAttribute('disabled');
                    } else {
                        okButton.setAttribute('disabled', 'true');
                    }
                };
                
                $input.on('input', updateButtonState);
                $input.on('keyup', updateButtonState);
                $input.on('paste', () => {
                    setTimeout(updateButtonState, 10);
                });
                
                $input.on('keydown', (e) => {
                    if (e.key === 'Enter' && !okButton.hasAttribute('disabled')) {
                        e.preventDefault();
                        okButton.click();
                    }
                });
                
                $input.focus();
                $input.select();
            },
            onClosing: async (popup) => {
                if (popup.result === POPUP_RESULT.AFFIRMATIVE) {
                    const $input = $(popup.content).find('#kv-cache-tag-input');
                    if ($input.length) {
                        tagValue = $input.val()?.trim() || null;
                    }
                }
                return true;
            }
        }
    );
    
    if (result === POPUP_RESULT.AFFIRMATIVE) {
        return tagValue;
    }
    
    return null;
}

export async function onSaveSlotButtonClick(event) {
    const button = $(event.target).closest('.kv-cache-save-slot-button');
    const slotIndex = parseInt(button.data('slot-index'));
    const characterName = button.data('character-name');
    
    if (isNaN(slotIndex) || !characterName) {
        showToast('error', t`Error: invalid slot data`, t`Saving Slot`);
        return;
    }
    
    // characterName from data attribute is already normalized (stored in slotsState)
    const slotsState = getSlotsState();
    const slot = slotsState[slotIndex];
    if (!slot || !slot.characterName || slot.characterName !== characterName) {
        showToast('error', t`Character not found in this slot`, t`Saving Slot`);
        return;
    }
    
    button.prop('disabled', true);
    const originalTitle = button.attr('title');
    button.attr('title', t`Saving...`);
    
    try {
        await saveCharacterCache(characterName, slotIndex);
    } catch (e) {
        console.error(`[KV Cache Manager] Error saving slot ${slotIndex}:`, e);
        showToast('error', t`Error saving: ${e.message}`, t`Saving Slot`);
    } finally {
        button.prop('disabled', false);
        button.attr('title', originalTitle);
    }
}
