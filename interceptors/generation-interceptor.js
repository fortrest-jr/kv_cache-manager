import { getContext } from "../../../../extensions.js";
import { t } from '../../../../i18n.js';

import { formatTimestampToDate } from '../utils/utils.js';
import { getSlotsState, acquireSlot } from '../core/slot-manager.js';
import { loadSlotCache } from '../core/cache-operations.js';
import { getLastCacheForCharacter, parseSaveFilename } from '../core/file-manager.js';
import { showToast } from '../ui/ui.js';
import { getNormalizedCharacterNameFromContext, getNormalizedCharacterNameFromData } from '../utils/character-utils.js';
import { MIN_USAGE_FOR_SAVE } from '../settings.js';

let currentSlot = null;
let isPreloading = false;
// Used instead of context because context may not be updated yet
let currentPreloadCharacter = null;

export function setPreloadingMode(enabled) {
    isPreloading = enabled;
    if (!enabled) {
        currentPreloadCharacter = null;
    }
}

export function setCurrentPreloadCharacter(normalizedName) {
    currentPreloadCharacter = normalizedName;
}

export function getCurrentSlot() {
    return currentSlot;
}

/**
 * Generation interceptor for loading character cache into slots
 * @param {any[]} chat - Chat messages array
 * @param {number} contextSize - Context size
 * @param {function(boolean): void} abort - Function to stop generation
 * @param {string} type - Generation type ('normal', 'regenerate', 'swipe', 'quiet', 'impersonate', 'continue')
 */
export async function KVCacheManagerInterceptor(chat, contextSize, abort, type) {
    if (type === 'impersonate') {
        return;
    }
    
    if (type === 'quiet' && !isPreloading) {
        return;
    }
    
    try {
        // In preload mode for quiet generations, use saved character name instead of context
        // because context may not be updated yet after forceChId
        const characterName = (type === 'quiet' && isPreloading && currentPreloadCharacter) 
            ? currentPreloadCharacter 
            : getNormalizedCharacterNameFromContext();
        
        if (!characterName) {
            return;
        }
        
        const slotsState = getSlotsState();
        currentSlot = await acquireSlot(characterName, MIN_USAGE_FOR_SAVE);
        
        if (currentSlot === null) {
            showToast('error', t`Failed to acquire slot for character ${characterName} during generation`, t`Generation`);
            return;
        }
        
        // Usage counter management happens here in generation interceptor
        // Load cache only if not already loaded in slot
        const slot = slotsState[currentSlot];
        const cacheNotLoaded = !slot?.cacheLoaded;
        
        if (cacheNotLoaded) {
            try {
                const cacheInfo = await getLastCacheForCharacter(characterName, true); // Only from current chat
                
                if (cacheInfo) {
                    await loadSlotCache(currentSlot, cacheInfo.filename, characterName);
                }
            } catch (e) {
                console.error(`[KV Cache Manager] Error loading cache for character ${characterName}:`, e);
                showToast('error', t`Error loading cache for ${characterName}: ${e.message}`, t`Generation`);
                // Don't interrupt generation on cache load error
            }
        }
        
        // Save generation type in slot for use in processMessageForAutoSave
        // Usage increment happens in processMessageForAutoSave on MESSAGE_RECEIVED event
        slotsState[currentSlot].generationType = type;
        
    } catch (error) {
        console.error('[KV Cache Manager] Error in generation interceptor:', error);
        showToast('error', t`Error intercepting generation: ${error.message}`, t`Generation`);
    }
}

export function setSlotForGeneration(params) {
    const slot = getCurrentSlot();
    if (slot !== null) {
        params["id_slot"] = slot;
    }
}

