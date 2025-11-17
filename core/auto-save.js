import { getSlotsState, findCharacterSlotIndex, incrementSlotUsage } from './slot-manager.js';
import { saveCharacterCache } from './cache-operations.js';
import { getExtensionSettings } from '../settings.js';
import { getNormalizedCharacterNameFromData } from '../utils/character-utils.js';

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
    
    // usage is reset automatically in saveCharacterCache after successful save
    try {
        const success = await saveCharacterCache(characterName, slotIndex);
        if (success) {
            const { updateSlotsList } = await import('./slot-manager.js');
            updateSlotsList();
        }
    } catch (e) {
        // Don't reset usage on error to retry save
        console.error(`[KV Cache Manager] Error auto-saving cache for character ${characterName}:`, e);
    }
}

// Increments only for normal generation or if usage === 0
export async function processMessageForAutoSave(data) {
    const extensionSettings = getExtensionSettings();
    
    if (!extensionSettings.enabled) {
        return;
    }
    
    const characterName = getNormalizedCharacterNameFromData(data);
    
    if (!characterName) {
        return;
    }
    
    const slotIndex = findCharacterSlotIndex(characterName);
    if (slotIndex === null) {
        return;
    }
    
    const slotsState = getSlotsState();
    const slot = slotsState[slotIndex];
    const generationType = slot?.generationType;
    
    // Increment usage only for normal or if usage === 0
    const shouldIncrement = (generationType === 'normal') || (slot?.usage === 0);
    
    if (shouldIncrement) {
        incrementSlotUsage(slotIndex);
        const updatedSlot = getSlotsState()[slotIndex];
        const newUsage = updatedSlot?.usage;
        
        await checkAndPerformAutoSave(slotIndex, newUsage);
        
        const { updateSlotsList } = await import('./slot-manager.js');
        updateSlotsList();
    }
    
    slot.generationType = null;
}
