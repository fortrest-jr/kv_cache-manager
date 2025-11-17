import { getContext } from "../../../../extensions.js";
import { getGroupMembers } from '../../../../group-chats.js';
import { t } from '../../../../i18n.js';

import LlamaApi from '../api/llama-api.js';
import { normalizeCharacterName, getNormalizedChatId } from '../utils/utils.js';
import { showToast } from '../ui/ui.js';
import { saveCharacterCache, saveAllSlotsCache, clearAllSlotsCache } from './cache-operations.js';
import { getExtensionSettings } from '../settings.js';

const llamaApi = new LlamaApi();

let slotsState = [];
let previousChatId = 'unknown';

export function getSlotsState() {
    return slotsState;
}

export function getSlotsCountFromData(slotsData) {
    if (Array.isArray(slotsData)) {
        return slotsData.length;
    } else if (typeof slotsData === 'object' && slotsData !== null) {
        return Object.keys(slotsData).length;
    }
    return 0;
}

export async function getAllSlotsInfo() {
    try {
        const slotsData = await llamaApi.getSlots();
        return slotsData;
    } catch (e) {
        console.error('[KV Cache Manager] Error getting slot information:', e);
        const errorMessage = e.message || String(e);
        const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('Timeout');
        if (!isTimeout) {
            //It happens too often while generation is in progress
            showToast('error', t`Error getting slot information: ${errorMessage}`);
        }
        return null;
    }
}

/**
 * Create slot object with character
 * @param {string} characterName - Normalized character name
 * @returns {Object} Slot object
 */
export function createSlotWithCharacter(characterName) {
    return {
        characterName: characterName,
        usage: 0,
        cacheLoaded: false,
        generationType: null
    };
}

export function createEmptySlot() {
    return createSlotWithCharacter(undefined);
}

export async function initializeSlots() {
    const slotsData = await getAllSlotsInfo();
    const totalSlots = slotsData ? getSlotsCountFromData(slotsData) : 4;
    
    slotsState = [];
    
    for (let i = 0; i < totalSlots; i++) {
        slotsState[i] = createEmptySlot();
    }
    
    updateSlotsList();
}

export function getNormalizedChatCharacters() {
    try {
        const context = getContext();
        
        if (!context) {
            console.warn('[KV Cache Manager] Failed to get chat context');
            return [];
        }
        
        if (context.groupId === null || context.groupId === undefined) {
            // Return only character name (name2), exclude user name (name1)
            const characterName = context.name2;
            if (characterName) {
                const normalizedName = normalizeCharacterName(characterName);
                return [normalizedName];
            }
            return [];
        } else {
            const groupMembers = getGroupMembers();
            
            if (!groupMembers || groupMembers.length === 0) {
                console.warn('[KV Cache Manager] No group chat members found');
                return [];
            }
            
            const normalizedNames = groupMembers
                .map(member => member?.name)
                .filter(name => name && typeof name === 'string')
                .map(name => normalizeCharacterName(name));
            
            return normalizedNames;
        }
    } catch (e) {
        console.error('[KV Cache Manager] Error getting chat characters:', e);
        return [];
    }
}

export async function assignCharactersToSlots() {
    if (slotsState.length === 0) {
        await initializeSlots();
    }
    
    const chatCharacters = getNormalizedChatCharacters();
    
    const totalSlots = slotsState.length;
    
    // Clear all slots completely (save should have occurred before calling this function)
    for (let i = 0; i < totalSlots; i++) {
        slotsState[i] = createEmptySlot();
    }
    
    if (chatCharacters.length === 0) {
        updateSlotsList();
        return;
    }
    
    // Assign characters to slots by index until either slots or characters run out
    // Names are already normalized from getNormalizedChatCharacters()
    for (let i = 0; i < totalSlots && i < chatCharacters.length; i++) {
        slotsState[i] = createSlotWithCharacter(chatCharacters[i]);
    }
    
    updateSlotsList();
}

/**
 * Find slot index for character (if character is already in slot)
 * @param {string} characterName - Normalized character name
 * @returns {number|null} Slot index or null if character not found in slots
 */
export function findCharacterSlotIndex(characterName) {
    // characterName must already be normalized
    const index = slotsState.findIndex(slot => {
        const slotName = slot?.characterName;
        return slotName && slotName === characterName;
    });
    
    return index !== -1 ? index : null;
}

/**
 * Get slot for character
 * 1. If character is already in slot - return that slot
 * 2. If not - find empty slot, return it
 * 3. If no empty slots - evict slot with least usage and return it
 * This function only manages slots, it does not manage the usage counter
 * @param {string} characterName - Normalized character name (used as identifier)
 * @param {number} minUsageForSave - Minimum usage count for saving (default: 1)
 * @param {Set<string>} protectedCharacters - Set of normalized character names that cannot be evicted (optional)
 * @returns {Promise<number|null>} Slot index or null if failed
 */
export async function acquireSlot(characterName, minUsageForSave = 1, protectedCharacters = null) {
    // characterName must already be normalized
    
    const existingIndex = findCharacterSlotIndex(characterName);
    if (existingIndex !== null) {
        updateSlotsList();
        return existingIndex;
    }
    
    const freeSlotIndex = slotsState.findIndex(slot => !slot?.characterName);
    if (freeSlotIndex !== -1) {
        // Usage counter always starts at 0, counter management is outside this function
        slotsState[freeSlotIndex] = createSlotWithCharacter(characterName);
        updateSlotsList();
        return freeSlotIndex;
    }
    
    // Find slot with lowest usage and evict it
    // Skip protected characters if specified
    let minUsage = Infinity;
    let minUsageIndex = -1;
    
    for (let i = 0; i < slotsState.length; i++) {
        const slot = slotsState[i];
        const slotCharacterName = slot?.characterName;
        
        if (protectedCharacters && slotCharacterName && protectedCharacters.has(slotCharacterName)) {
            continue;
        }
        
        const currentUsage = slot?.usage || 0;
        if (currentUsage < minUsage) {
            minUsage = currentUsage;
            minUsageIndex = i;
        }
    }
    
    if (minUsageIndex === -1) {
        console.warn('[KV Cache Manager] Failed to find slot for character (possibly all slots are occupied by protected characters)');
        return null;
    }
    
    const evictedSlot = slotsState[minUsageIndex];
    const evictedCharacter = evictedSlot?.characterName;
    
    if (evictedCharacter && typeof evictedCharacter === 'string') {
        const usageCount = evictedSlot.usage;
        
        // Save cache before eviction only if character used slot at least N times
        if (usageCount >= minUsageForSave) {
            await saveCharacterCache(evictedCharacter, minUsageIndex);
        }
    }
    
    // Usage counter always starts at 0, counter management is outside this function
    slotsState[minUsageIndex] = createSlotWithCharacter(characterName);
    
    updateSlotsList();
    
    return minUsageIndex;
}

export async function updateSlotsList() {
    const slotsListElement = $("#kv-cache-slots-list");
    if (slotsListElement.length === 0) {
        return;
    }
    
    try {
        const slotsData = await getAllSlotsInfo();
        const totalSlots = slotsData ? getSlotsCountFromData(slotsData) : 0;
        
        let html = '<ul style="margin: 5px 0; padding-left: 0px;">';
        let usedCount = 0;
        
        for (let i = 0; i < slotsState.length; i++) {
            const slot = slotsState[i];
            const characterName = slot?.characterName;
            const isUsed = characterName && typeof characterName === 'string';
            
            if (isUsed) {
                usedCount++;
            }
            
            html += `<li style="margin: 3px 0; display: flex; align-items: center; gap: 5px;">`;
            
            if (isUsed) {
                const saveTitle = t`Save cache for ${characterName}`;
                html += `<button class="kv-cache-save-slot-button" data-slot-index="${i}" data-character-name="${characterName}" style="background: none; cursor: pointer; padding: 2px 4px; display: inline-flex; align-items: center; color: var(--SmartThemeBodyColor, #888); margin-left: 0;" title="${saveTitle}">`;
                html += `<i class="fa-solid fa-floppy-disk" style="font-size: 0.85em;"></i>`;
                html += `</button>`;
            } else {
                html += `<span style="width: 20px; display: inline-block;"></span>`;
            }
            
            html += `<span>${t`Slot ${i}:`} `;
            
            if (isUsed) {
                const messageCount = slot?.usage || 0;
                html += `<span style="color: var(--SmartThemeBodyColor, inherit);">${characterName}</span> `;
                html += `<span style="font-size: 0.85em; color: var(--SmartThemeBodyColor, #888);">${t`[messages: ${messageCount}]`}</span>`;
            } else {
                html += `<span style="color: #888; font-style: italic;">${t`(free)`}</span>`;
            }
            
            html += `</span></li>`;
        }
        
        const freeSlots = totalSlots - usedCount;
        const usedLabel = t`Used: ${usedCount} / ${totalSlots} (free: ${freeSlots})`;
        html += '</ul>';
        html += `<p style="margin-top: 5px; font-size: 0.9em; color: var(--SmartThemeBodyColor, inherit);">${usedLabel}</p>`;
        
        slotsListElement.html(html);
    } catch (e) {
        console.error('[KV Cache Manager] Error updating slots list:', e);
        const errorMessage = e.message || 'Unknown error';
        const errorText = t`Error loading slots: ${errorMessage}`;
        slotsListElement.html(`<p style="color: var(--SmartThemeBodyColor, inherit);">${errorText}</p>`);
    }
}

export function incrementSlotUsage(slotIndex) {
    if (slotsState[slotIndex]) {
        slotsState[slotIndex].usage = (slotsState[slotIndex].usage || 0) + 1;
    }
}

export function setSlotCacheLoaded(slotIndex, loaded = true) {
    if (slotsState[slotIndex]) {
        slotsState[slotIndex].cacheLoaded = loaded;
    }
}

export function resetSlotUsage(slotIndex) {
    if (slotsState[slotIndex]) {
        slotsState[slotIndex].usage = 0;
    }
}

export function initializePreviousChatId() {
    previousChatId = 'unknown';
}

export async function redistributeCharacters() {
    const currentChatId = getNormalizedChatId();
    const previousChatIdNormalized = previousChatId;
    const extensionSettings = getExtensionSettings();
    
    // Update previousChatId for next event (never assign 'unknown')
    if (currentChatId !== 'unknown') {
        previousChatId = currentChatId;
    }
    
    await processChatChange(previousChatIdNormalized, currentChatId, extensionSettings);
}

async function processChatChange(previousChatIdParam, currentChatId, extensionSettings) {
    // previousChatId can only be 'unknown' on first chat change
    const chatIdChanged = currentChatId !== 'unknown' &&
                          previousChatIdParam !== currentChatId;
    
    if (!chatIdChanged) {
        return false;
    }
    
    if (!extensionSettings.clearOnChatChange) {
        return false;
    }
    
    // IMPORTANT: Save cache for all characters in slots first
    await saveAllSlotsCache();
    
    await clearAllSlotsCache();
    
    await assignCharactersToSlots();
    
    return true;
}
