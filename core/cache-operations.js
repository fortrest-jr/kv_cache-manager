import LlamaApi from '../api/llama-api.js';
import { formatTimestamp, getNormalizedChatId } from '../utils/utils.js';
import { generateSaveFilename, rotateCharacterFiles, validateCacheFile } from './file-manager.js';
import { getAllSlotsInfo, getSlotsState, resetSlotUsage, setSlotCacheLoaded, getSlotsCountFromData, updateSlotsList } from './slot-manager.js';
import { showToast, disableAllSaveButtons, enableAllSaveButtons, showTagInputPopup } from '../ui/ui.js';
import { getExtensionSettings, MIN_USAGE_FOR_SAVE } from '../settings.js';
import { t } from '../../../../i18n.js';

const llamaApi = new LlamaApi();

/**
 * Save cache for slot
 * @param {number} slotId - Slot index
 * @param {string} filename - Filename for saving
 * @param {string} characterName - Character name (required)
 * @returns {Promise<boolean>} true if saved successfully
 */
export async function saveSlotCache(slotId, filename, characterName) {
    try {
        await llamaApi.saveSlotCache(slotId, filename);
        
        const isValid = await validateCacheFile(filename, characterName);
        if (!isValid) {
            return false;
        }
        
        showToast('success', t`Cache for ${characterName} saved successfully`);
        
        return true;
    } catch (e) {
        console.error(`[KV Cache Manager] Error saving slot ${slotId}:`, e);
        const errorMessage = e.message || 'Unknown error';
        if (errorMessage.includes('Timeout') || errorMessage.includes('timeout')) {
            showToast('error', t`Timeout while saving cache for ${characterName}`);
        } else {
            showToast('error', t`Error saving cache for ${characterName}: ${errorMessage}`);
        }
        return false;
    }
}

/**
 * Load cache for slot
 * @param {number} slotId - Slot index
 * @param {string} filename - Filename to load
 * @param {string} characterName - Character name (for notifications)
 * @returns {Promise<boolean>} true if loaded successfully
 */
export async function loadSlotCache(slotId, filename, characterName) {
    try {
        await llamaApi.loadSlotCache(slotId, filename);
        
        // Reset usage counter to 0 and mark cache as loaded on any cache load
        resetSlotUsage(slotId);
        setSlotCacheLoaded(slotId, true);
        
        updateSlotsList();
        
        showToast('success', t`Cache for ${characterName} loaded successfully`, t`Cache Loading`);
        
        return true;
    } catch (e) {
        console.error(`[KV Cache Manager] Error loading cache for slot ${slotId}:`, e);
        
        const errorMessage = e.message || 'Unknown error';
        const isFileNotFound = errorMessage.includes('404');
        
        if (isFileNotFound) {
            showToast('warning', t`File not found for ${characterName}: ${filename}`, t`Cache Loading`);
        } else {
            showToast('error', t`Error loading cache for ${characterName}: ${errorMessage}`, t`Cache Loading`);
        }
        
        return false;
    }
}

export async function clearSlotCache(slotId) {
    try {
        await llamaApi.clearSlotCache(slotId);
        
        updateSlotsList();
        
        return true;
    } catch (e) {
        console.error(`[KV Cache Manager] Error clearing slot ${slotId}:`, e);
        return false;
    }
}

export async function clearAllSlotsCache() {
    try {
        const slotsData = await getAllSlotsInfo();
        
        if (!slotsData) {
            return false;
        }
        
        const totalSlots = getSlotsCountFromData(slotsData);
        
        if (totalSlots === 0) {
            return true;
        }
        
        let clearedCount = 0;
        let errors = [];
        
        for (let slotId = 0; slotId < totalSlots; slotId++) {
            try {
                if (await clearSlotCache(slotId)) {
                    clearedCount++;
                } else {
                    errors.push(`слот ${slotId}`);
                }
            } catch (e) {
                console.error(`[KV Cache Manager] Error clearing slot ${slotId}:`, e);
                errors.push(`слот ${slotId}: ${e.message}`);
            }
        }
        
        if (clearedCount > 0) {
            if (errors.length > 0) {
                showToast('warning', t`Cleared ${clearedCount} of ${totalSlots} slots. Errors: ${errors.join(', ')}`, t`Cache Clear`);
            } else {
                showToast('success', t`Successfully cleared ${clearedCount} slots`, t`Cache Clear`);
            }
            
            // clearSlotCache() already updates after each clear, but final update ensures accuracy
            updateSlotsList();
            
            return true;
        } else {
            console.error(`[KV Cache Manager] Failed to clear slots. Errors: ${errors.join(', ')}`);
            showToast('error', t`Failed to clear slots. Errors: ${errors.join(', ')}`, t`Cache Clear`);
            return false;
        }
    } catch (e) {
        console.error('[KV Cache Manager] Error clearing all slots:', e);
        showToast('error', t`Error clearing slots: ${e.message}`, t`Cache Clear`);
        return false;
    }
}

/**
 * Save cache for character (auto-save)
 * @param {string} characterName - Normalized character name
 * @param {number} slotIndex - Slot index
 * @returns {Promise<boolean>} true if cache was saved, false on error
 */
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
        
        const success = await saveSlotCache(slotIndex, filename, characterName);
        
        if (success) {
            await rotateCharacterFiles(characterName);
            
            resetSlotUsage(slotIndex);
            
            return true;
        } else {
            console.error(`[KV Cache Manager] Failed to save cache for character ${characterName}`);
            return false;
        }
    } catch (e) {
        console.error(`[KV Cache Manager] Error saving cache for character ${characterName}:`, e);
        return false;
    }
}

export async function saveAllSlotsCache() {
    const slotsState = getSlotsState();
    const totalSlots = slotsState.length;
    
    disableAllSaveButtons();
    
    try {
        // IMPORTANT: Wait for save completion before clearing slots to avoid data loss
        for (let i = 0; i < totalSlots; i++) {
            const slot = slotsState[i];
            const currentCharacter = slot?.characterName;
            if (currentCharacter && typeof currentCharacter === 'string') {
                const usageCount = slot.usage || 0;
                
                // Save cache before eviction only if character used slot at least N times
                if (usageCount >= MIN_USAGE_FOR_SAVE) {
                    await saveCharacterCache(currentCharacter, i);
                }
            }
        }
    } finally {
        enableAllSaveButtons();
    }
}

export async function saveCache(requestTag = false) {
    let tag = null;
    if (requestTag) {
        tag = await showTagInputPopup();
        if (tag === null) {
            return false;
        }
        tag = tag.trim();
    }
    
    const chatId = getNormalizedChatId();
    
    showToast('info', t`Starting cache save...`);
    
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
        showToast('warning', t`No characters in slots to save`);
        return false;
    }
    
    const successfullySaved = [];
    const saveErrors = [];
    
    const extensionSettings = getExtensionSettings();
    
    for (const { characterName, slotIndex } of charactersToSave) {
        if (!characterName) {
            // Skip if character name is undefined (temporary solution for normal mode)
            continue;
        }
        
        try {
            const timestamp = formatTimestamp();
            const filename = generateSaveFilename(chatId, timestamp, characterName, tag);
            
            if (await saveSlotCache(slotIndex, filename, characterName)) {
                successfullySaved.push(characterName);
                
                // Rotate files only for auto-saves (not for tagged saves)
                if (!tag) {
                    await rotateCharacterFiles(characterName);
                }
            } else {
                saveErrors.push(characterName);
            }
        } catch (e) {
            console.error(`[KV Cache Manager] Error saving character ${characterName}:`, e);
            saveErrors.push(`${characterName}: ${e.message}`);
        }
    }
    
    return successfullySaved.length > 0;
}
