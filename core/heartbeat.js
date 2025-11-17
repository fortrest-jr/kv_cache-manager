import { generateQuietPrompt } from "../../../../../script.js";
import { t } from '../../../../i18n.js';

import { getNormalizedChatId } from '../utils/utils.js';
import { getExtensionSettings } from '../settings.js';
import { getAllSlotsInfo } from './slot-manager.js';
import { showToast } from '../ui/ui.js';

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
    if (extensionSettings.heartbeat <= 0) {
        return;
    }

    if (isHeartbeatGenerating) {
        return;
    }

    const chatId = getNormalizedChatId();
    if (chatId === 'unknown') {
        return;
    }

    if (getPreloadingMode && getPreloadingMode()) {
        return;
    }

    if (await isGenerationInProgress()) {
        return;
    }

    isHeartbeatGenerating = true;

    try {
        await generateQuietPrompt({
            responseLength: 1
        });
        
        if (extensionSettings.showHeartbeatNotifications) {
            showToast('success', t`Heartbeat: LLM kept warm`, 'Heartbeat');
        }
    } catch (e) {
        if (extensionSettings.showHeartbeatNotifications) {
            showToast('error', t`Heartbeat: Generation error - ${e.message}`, 'Heartbeat');
        }
        console.debug('[KV Cache Manager] Heartbeat generation error (ignored):', e);
    } finally {
        isHeartbeatGenerating = false;
    }
}

/**
 * Start heartbeat interval
 */
export function startHeartbeat() {
    stopHeartbeat();
    
    const extensionSettings = getExtensionSettings();
    
    if (extensionSettings.heartbeat <= 0) {
        return;
    }

    const intervalMs = extensionSettings.heartbeat * 1000;
    heartbeatInterval = setInterval(() => {
        performHeartbeat();
    }, intervalMs);

    console.log(`[KV Cache Manager] Heartbeat started (every ${extensionSettings.heartbeat} seconds)`);
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

