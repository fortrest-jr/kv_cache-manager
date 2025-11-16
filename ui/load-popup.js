import { getCurrentChatId } from "../../../../../script.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../popup.js';
import { t } from '../../../../i18n.js';

import { getNormalizedChatId, formatTimestampToDate } from '../utils/utils.js';
import { getFilesList, parseSaveFilename, groupFilesByChatAndCharacter, getLastCacheForCharacter } from '../core/file-manager.js';
import { getSlotsState, acquireSlot, updateSlotsList } from '../core/slot-manager.js';
import { loadSlotCache } from '../core/cache-operations.js';
import { showToast } from './ui.js';
import { getExtensionSettings, extensionFolderPath, MIN_USAGE_FOR_SAVE } from '../settings.js';

let loadPopupData = {
    chats: {},
    currentChatId: null,
    selectedChatId: null,
    selectedCharacters: {},
    searchQuery: '',
    currentPopup: null
};

function setupLoadPopupHandlers() {
    $(document).off('click', '.kv-cache-load-chat-item-current').on('click', '.kv-cache-load-chat-item-current', function() {
        const popupDlg = $(this).closest('.popup, dialog');
        selectLoadPopupChat('current', popupDlg.length ? popupDlg[0] : document);
    });
    
    $(document).off('click', '.kv-cache-load-chat-item:not(.kv-cache-load-chat-item-current)').on('click', '.kv-cache-load-chat-item:not(.kv-cache-load-chat-item-current)', function() {
        const chatId = $(this).data('chat-id');
        if (chatId) {
            const popupDlg = $(this).closest('.popup, dialog');
            selectLoadPopupChat(chatId, popupDlg.length ? popupDlg[0] : document);
        }
    });
    
    $(document).off('input', '#kv-cache-load-search-input').on('input', '#kv-cache-load-search-input', function() {
        const query = $(this).val();
        const popupDlg = $(this).closest('.popup, dialog');
        updateSearchQuery(query, popupDlg.length ? popupDlg[0] : document);
    });
}

export async function openLoadPopup() {
    const filesList = await getFilesList();
    
    if (!filesList || filesList.length === 0) {
        showToast('warning', 'No saved caches found for loading');
        return;
    }
    
    loadPopupData.chats = groupFilesByChatAndCharacter(filesList);
    loadPopupData.currentChatId = getNormalizedChatId();
    loadPopupData.selectedChatId = null;
    loadPopupData.selectedCharacters = {};
    loadPopupData.searchQuery = '';
    
    const popupHTML = await $.get(`${extensionFolderPath}/load-popup.html`);
    
    let loadPerformed = false;
    
    const performLoad = async () => {
        if (Object.keys(loadPopupData.selectedCharacters).length === 0) {
            showToast('error', 'No characters selected');
            return false;
        }
        
        loadPerformed = true;
        await loadSelectedCache();
        return true;
    };
    
    const popupPromise = callGenericPopup(
        popupHTML,
        POPUP_TYPE.TEXT,
        '',
        {
            large: true,
            allowVerticalScrolling: true,
            okButton: 'Load',
            cancelButton: true,
            onOpen: async (popup) => {
                loadPopupData.currentPopup = popup;
                
                await new Promise(resolve => setTimeout(resolve, 100));
                
                const popupContent = popup.content.querySelector('#kv-cache-load-popup-content');
                if (!popupContent) {
                    console.error('[KV Cache Manager] Popup content not found in', popup.content);
                    return;
                }
                
                setupLoadPopupHandlers();
                
                renderLoadPopupChats(popup.dlg);
                selectLoadPopupChat('current', popup.dlg);
                
                const loadButton = popup.okButton;
                if (loadButton) {
                    loadButton.disabled = true;
                }
            },
            onClosing: async (popup) => {
                if (popup.result === POPUP_RESULT.AFFIRMATIVE && !loadPerformed) {
                    if (Object.keys(loadPopupData.selectedCharacters).length === 0) {
                        showToast('error', 'No characters selected');
                        return false;
                    }
                    await performLoad();
                }
                return true;
            },
            onClose: async (popup) => {
                loadPopupData.currentPopup = null;
            }
        }
    );
    
    await popupPromise;
}

export function closeLoadPopup() {
    loadPopupData.selectedCharacters = {};
    loadPopupData.searchQuery = '';
}

export function renderLoadPopupChats(context = document) {
    const chatsList = $(context).find("#kv-cache-load-chats-list");
    if (chatsList.length === 0) {
        console.error('[KV Cache Manager] Element #kv-cache-load-chats-list not found in context', context);
        return;
    }
    
    const currentChatId = loadPopupData.currentChatId;
    const chats = loadPopupData.chats;
    
    const currentChatCharacters = chats[currentChatId] || {};
    const currentCount = Object.values(currentChatCharacters).reduce((sum, files) => sum + files.length, 0);
    const rawChatId = getCurrentChatId() || 'unknown';
    $(context).find(".kv-cache-load-chat-item-current .kv-cache-load-chat-name-text").text(rawChatId + ' ' + t`[current]`);
    $(context).find(".kv-cache-load-chat-item-current .kv-cache-load-chat-count").text(currentCount > 0 ? currentCount : '-');
    
    const searchQuery = loadPopupData.searchQuery.toLowerCase();
    const filteredChats = Object.keys(chats).filter(chatId => {
        if (chatId === currentChatId) return true;
        if (searchQuery && !chatId.toLowerCase().includes(searchQuery)) return false;
        return true;
    });
    
    chatsList.empty();
    
    for (const chatId of filteredChats) {
        if (chatId === currentChatId) continue;
        
        const chatCharacters = chats[chatId] || {};
        const totalFiles = Object.values(chatCharacters).reduce((sum, files) => sum + files.length, 0);
        
        const chatItem = $(`
            <div class="kv-cache-load-chat-item" data-chat-id="${chatId}">
                <div class="kv-cache-load-chat-name">
                    <i class="fa-solid fa-comment" style="margin-right: 5px;"></i>
                    ${chatId}
                </div>
                <div class="kv-cache-load-chat-count">${totalFiles}</div>
            </div>
        `);
        
        chatItem.on('click', function() {
            const popupDlg = $(this).closest('.popup, dialog');
            selectLoadPopupChat(chatId, popupDlg.length ? popupDlg[0] : document);
        });
        chatsList.append(chatItem);
    }
}

export function selectLoadPopupChat(chatId, context = document) {
    $(context).find(".kv-cache-load-chat-item").removeClass('active');
    
    if (chatId === 'current') {
        $(context).find(".kv-cache-load-chat-item-current").addClass('active');
        chatId = loadPopupData.currentChatId;
    } else {
        $(context).find(`.kv-cache-load-chat-item[data-chat-id="${chatId}"]`).addClass('active');
    }
    
    loadPopupData.selectedChatId = chatId;
    
    renderLoadPopupFiles(chatId, context);
    
    loadPopupData.selectedCharacters = {};
    $(context).find("#kv-cache-load-confirm-button").prop('disabled', true);
    $(context).find("#kv-cache-load-selected-info").text('No characters selected');
}

export function renderLoadPopupFiles(chatId, context = document) {
    const filesList = $(context).find("#kv-cache-load-files-list");
    if (filesList.length === 0) {
        console.error('[KV Cache Manager] Element #kv-cache-load-files-list not found in context', context);
        return;
    }
    
    const chats = loadPopupData.chats;
    const chatCharacters = chats[chatId] || {};
    const searchQuery = loadPopupData.searchQuery.toLowerCase();
    
    const characterNames = Object.keys(chatCharacters);
    
    if (characterNames.length === 0) {
        filesList.html(`<div class="kv-cache-load-empty">${t`No files for this chat`}</div>`);
        return;
    }
    
    const filteredCharacters = characterNames.filter(characterName => {
        if (!searchQuery) return true;
        return characterName.toLowerCase().includes(searchQuery);
    });
    
    if (filteredCharacters.length === 0) {
        filesList.html(`<div class="kv-cache-load-empty">${t`No characters found for query`}</div>`);
        return;
    }
    
    // Sort characters: those in slots first (only for current chat)
    const isCurrentChat = chatId === loadPopupData.currentChatId;
    if (isCurrentChat) {
        const slotsState = getSlotsState();
        const slotsCharacters = new Set(
            slotsState
                .map(slot => slot?.characterName)
                .filter(name => name && typeof name === 'string')
        );
        
        filteredCharacters.sort((a, b) => {
            const aInSlots = slotsCharacters.has(a);
            const bInSlots = slotsCharacters.has(b);
            
            if (aInSlots && !bInSlots) return -1;
            if (!aInSlots && bInSlots) return 1;
            
            return 0;
        });
    }
    
    filesList.empty();
    
    for (const characterName of filteredCharacters) {
        const characterFiles = chatCharacters[characterName];
        const saveCount = characterFiles.length;
        const savePlural = saveCount !== 1 ? 's' : '';
        
        const characterElement = $(`
            <div class="kv-cache-load-file-group collapsed" data-character-name="${characterName}">
                <div class="kv-cache-load-file-group-header">
                    <div class="kv-cache-load-file-group-title">
                        <i class="fa-solid fa-user"></i>
                        ${characterName}
                    </div>
                    <div class="kv-cache-load-file-group-info">
                        <span>${t`${saveCount} save${savePlural}`}</span>
                        <i class="fa-solid fa-chevron-down kv-cache-load-file-group-toggle"></i>
                    </div>
                </div>
                <div class="kv-cache-load-file-group-content">
                </div>
            </div>
        `);
        
        const content = characterElement.find('.kv-cache-load-file-group-content');
        for (const file of characterFiles) {
            const dateTime = formatTimestampToDate(file.timestamp);
            const tagLabel = file.tag ? t` [tag: ${file.tag}]` : '';
            
            const timestampItem = $(`
                <div class="kv-cache-load-file-item" data-character-name="${characterName}" data-timestamp="${file.timestamp}" data-filename="${file.filename}">
                    <div class="kv-cache-load-file-item-info">
                        <div class="kv-cache-load-file-item-name">
                            <i class="fa-solid fa-calendar"></i>
                            ${dateTime}${tagLabel}
                        </div>
                    </div>
                </div>
            `);
            
            const isSelected = loadPopupData.selectedCharacters[characterName] === file.timestamp;
            if (isSelected) {
                timestampItem.addClass('selected');
            }
            
            timestampItem.on('click', function(e) {
                e.stopPropagation();
                
                const isCurrentlySelected = loadPopupData.selectedCharacters[characterName] === file.timestamp;
                
                if (isCurrentlySelected) {
                    timestampItem.removeClass('selected');
                    delete loadPopupData.selectedCharacters[characterName];
                } else {
                    $(`.kv-cache-load-file-item[data-character-name="${characterName}"]`).removeClass('selected');
                    
                    timestampItem.addClass('selected');
                    
                    const selectedTimestamp = file.timestamp;
                    loadPopupData.selectedCharacters[characterName] = selectedTimestamp;
                }
                
                const popupDlg = timestampItem.closest('.popup, dialog');
                updateLoadPopupSelection(popupDlg.length ? popupDlg[0] : document);
            });
            
            content.append(timestampItem);
        }
        
        characterElement.find('.kv-cache-load-file-group-header').on('click', function(e) {
            if ($(e.target).closest('.kv-cache-load-file-item').length) return;
            
            if ($(e.target).hasClass('kv-cache-load-file-group-toggle') || 
                $(e.target).closest('.kv-cache-load-file-group-title').length ||
                $(e.target).closest('.kv-cache-load-file-group-info').length) {
                characterElement.toggleClass('collapsed');
            }
        });
        
        filesList.append(characterElement);
    }
}

export function updateLoadPopupSelection(context = document) {
    const selectedCount = Object.keys(loadPopupData.selectedCharacters).length;
    const selectedInfo = $(context).find("#kv-cache-load-selected-info");
    
    if (selectedInfo.length === 0) {
        return;
    }
    
    const loadButton = loadPopupData.currentPopup?.okButton;
    
    if (selectedCount === 0) {
        selectedInfo.text('No characters selected');
        if (loadButton) {
            loadButton.disabled = true;
        }
    } else {
        const charactersList = Object.keys(loadPopupData.selectedCharacters).join(', ');
        selectedInfo.html(`<strong>Выбрано:</strong> ${selectedCount} персонаж${selectedCount !== 1 ? 'ей' : ''} (${charactersList})`);
        if (loadButton) {
            loadButton.disabled = false;
        }
    }
}

export async function loadSelectedCache() {
    const selectedCharacters = loadPopupData.selectedCharacters;
    
    if (!selectedCharacters || Object.keys(selectedCharacters).length === 0) {
        showToast('error', 'Персонажи не выбраны');
        return;
    }
    
    const selectedChatId = loadPopupData.selectedChatId || loadPopupData.currentChatId || getNormalizedChatId();
    const chats = loadPopupData.chats;
    const chatCharacters = chats[selectedChatId] || {};
    
    let loadedCount = 0;
    let errors = [];
    
    const selectedCount = Object.keys(selectedCharacters).length;
    const slotsState = getSlotsState();
    const totalSlots = slotsState.length;
    
    if (selectedCount > totalSlots) {
        showToast('error', t`Selected ${selectedCount} characters, but only ${totalSlots} slots available. Select no more than ${totalSlots} characters.`);
        return;
    }
    
    const extensionSettings = getExtensionSettings();
    
    // Step 1: Prepare selected character data and create Set of protected characters
    // Character names are already normalized in groupFilesByChatAndCharacter()
    const charactersToLoad = [];
    const protectedCharactersSet = new Set();
    
    for (const characterName in selectedCharacters) {
        const selectedTimestamp = selectedCharacters[characterName];
        const characterFiles = chatCharacters[characterName] || [];
        const fileToLoad = characterFiles.find(f => f.timestamp === selectedTimestamp);
        
        if (!fileToLoad) {
            const errorMsg = `${characterName}: file not found`;
            errors.push(errorMsg);
            continue;
        }
        
        protectedCharactersSet.add(characterName);
        charactersToLoad.push({
            characterName: characterName,
            fileToLoad: fileToLoad
        });
    }
    
    if (charactersToLoad.length === 0) {
        showToast('error', 'No files found for loading', t`Loading`);
        return;
    }
    
    // Step 2: Assign all selected characters to slots
    // Use acquireSlot() with protected characters so they don't evict each other
    // Character names are already normalized
    const characterSlotMap = new Map();
    
    for (const character of charactersToLoad) {
        try {
            // acquireSlot() automatically checks if character is already in slot,
            // and if not - finds free slot or evicts unprotected character
            const slotIndex = await acquireSlot(character.characterName, MIN_USAGE_FOR_SAVE, protectedCharactersSet);
            
            if (slotIndex === null) {
                errors.push(t`${character.characterName}: failed to acquire slot`);
                continue;
            }
            
            characterSlotMap.set(character.characterName, slotIndex);
        } catch (e) {
            console.error(`[KV Cache Manager] Error assigning character ${character.characterName} to slot:`, e);
            errors.push(`${character.characterName}: ${e.message}`);
        }
    }
    
    // Step 3: Load caches for all characters
    for (const character of charactersToLoad) {
        const slotIndex = characterSlotMap.get(character.characterName);
        
        if (slotIndex === undefined) {
            continue;
        }
        
        try {
            const loaded = await loadSlotCache(slotIndex, character.fileToLoad.filename, character.characterName);
            
            if (loaded) {
                loadedCount++;
            } else {
                const errorMsg = t`${character.characterName}: load error`;
                errors.push(errorMsg);
            }
        } catch (e) {
            console.error(`[KV Cache Manager] Error loading cache for character ${character.characterName}:`, e);
            const errorMsg = `${character.characterName}: ${e.message}`;
            errors.push(errorMsg);
        }
    }
    
    if (loadedCount > 0) {
        if (errors.length > 0) {
            showToast('warning', t`Loaded ${loadedCount} of ${Object.keys(selectedCharacters).length} characters. Errors: ${errors.join(', ')}`, t`Loading`);
        } else {
            showToast('success', t`Successfully loaded ${loadedCount} characters`, t`Loading`);
        }
        
        // loadSlotCache() already updates after each load, but final update ensures accuracy
        updateSlotsList();
    } else {
        showToast('error', t`Failed to load caches. Errors: ${errors.join(', ')}`, t`Loading`);
    }
}

export function updateSearchQuery(query, context = document) {
    loadPopupData.searchQuery = query;
    renderLoadPopupChats(context);
    const activeChat = $(context).find(".kv-cache-load-chat-item.active");
    const activeCurrentChat = $(context).find(".kv-cache-load-chat-item-current.active");
    
    let currentChatId = null;
    if (activeChat.length) {
        currentChatId = activeChat.data('chat-id');
    } else if (activeCurrentChat.length) {
        currentChatId = loadPopupData.currentChatId;
    }
    
    if (currentChatId) {
        loadPopupData.selectedChatId = currentChatId;
        renderLoadPopupFiles(currentChatId, context);
    }
}
