import { generateQuietPrompt } from "../../../../../script.js";

import { getNormalizedChatId } from '../utils/utils.js';
import { getExtensionSettings, LLAMA_HEARTBEAT_INTERVAL_MS } from '../settings.js';
import { getAllSlotsInfo } from './slot-manager.js';
import { showToast } from '../ui/ui.js';

// Import to check preload mode
let getPreloadingMode = null;

let heartbeatInterval = null;
let isHeartbeatGenerating = false;

/**
 * Проверяет, идет ли в данный момент генерация
 * @returns {Promise<boolean>} true если генерация активна
 */
async function isGenerationInProgress() {
    const slotsData = await getAllSlotsInfo();
    
    if (!slotsData || !Array.isArray(slotsData)) {
        return false;
    }
    
    // Проверяем каждый слот на наличие активной генерации
    // В llama.cpp слоты имеют boolean поле "is_processing"
    for (const slot of slotsData) {
        if (slot.is_processing === true) {
            return true;
        }
    }
    return false;
}

/**
 * Set function to check preload mode (called from interceptor)
 */
export function setPreloadModeChecker(checker) {
    getPreloadingMode = checker;
}

/**
 * Perform heartbeat generation - generate 1 token to keep LLM warm
 */
async function performHeartbeat() {
    const extensionSettings = getExtensionSettings();
    if (!extensionSettings.heartbeat) {
        return;
    }

    if (isHeartbeatGenerating) {
        return;
    }

    // Check if chat is not unknown
    const chatId = getNormalizedChatId();
    if (chatId === 'unknown') {
        return;
    }

    // Check if preload mode is active - don't run heartbeat during preload
    if (getPreloadingMode && getPreloadingMode()) {
        return;
    }

    const isGenerating = await isGenerationInProgress();
    if (isGenerating) {
        return;
    }

    // Start heartbeat generation
    isHeartbeatGenerating = true;

    try {
        // Generate 1 token quietly to keep LLM warm
        await generateQuietPrompt({
            responseLength: 1
        });
        // Show success toast
        showToast('success', 'Heartbeat: LLM kept warm', 'Heartbeat');
    } catch (e) {
        // Silently ignore errors - heartbeat should not interrupt user experience
        console.debug('[KV Cache Manager] Heartbeat generation error (ignored):', e);
    } finally {
        isHeartbeatGenerating = false;
    }
}

/**
 * Start heartbeat interval
 */
export function startHeartbeat() {
    stopHeartbeat(); // Stop any existing interval
    
    const extensionSettings = getExtensionSettings();
    
    if (!extensionSettings.heartbeat) {
        return;
    }

    // Run heartbeat every 30 seconds
    heartbeatInterval = setInterval(() => {
        performHeartbeat();
    }, LLAMA_HEARTBEAT_INTERVAL_MS);

    console.log('[KV Cache Manager] Heartbeat started (every 30 seconds)');
}

/**
 * Stop heartbeat interval
 */
export function stopHeartbeat() {
    if (heartbeatInterval !== null) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
        console.log('[KV Cache Manager] Heartbeat stopped');
    }
}

/**
 * Check if heartbeat is currently generating
 * @returns {boolean} True if heartbeat generation is active
 */
export function isHeartbeatActive() {
    return isHeartbeatGenerating;
}

