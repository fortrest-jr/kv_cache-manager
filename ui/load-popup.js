// Popup загрузки для KV Cache Manager

import { getCurrentChatId } from "../../../../../script.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../../scripts/popup.js';

import { getNormalizedChatId, formatTimestampToDate } from '../utils/utils.js';
import { getFilesList, parseSaveFilename, groupFilesByChatAndCharacter, getLastCacheForCharacter } from '../core/file-manager.js';
import { getSlotsState, acquireSlot, updateSlotsList } from '../core/slot-manager.js';
import { loadSlotCache, saveCharacterCache } from '../core/cache-operations.js';
import { showToast } from './ui.js';
import { getExtensionSettings, extensionFolderPath, MIN_USAGE_FOR_SAVE } from '../settings.js';

// Используем стандартный POPUP_RESULT.AFFIRMATIVE для кнопки "Загрузить"

// Глобальные переменные для popup загрузки
// Новая структура: { [chatId]: { [characterName]: [{ timestamp, filename, tag }, ...] } }
let loadPopupData = {
    chats: {}, // Структура: { [chatId]: { [characterName]: [{ timestamp, filename, tag }, ...] } }
    currentChatId: null, // ID текущего чата (для отображения)
    selectedChatId: null, // ID выбранного чата в popup (для загрузки)
    selectedCharacters: {}, // { [characterName]: timestamp } - выбранные персонажи и их timestamp
    searchQuery: '',
    currentPopup: null // Ссылка на текущий открытый popup
};

// Настройка обработчиков событий для popup
function setupLoadPopupHandlers() {
    // Обработчик для текущего чата
    $(document).off('click', '.kv-cache-load-chat-item-current').on('click', '.kv-cache-load-chat-item-current', function() {
        const popupDlg = $(this).closest('.popup, dialog');
        selectLoadPopupChat('current', popupDlg.length ? popupDlg[0] : document);
    });
    
    // Обработчик для других чатов (делегирование)
    $(document).off('click', '.kv-cache-load-chat-item:not(.kv-cache-load-chat-item-current)').on('click', '.kv-cache-load-chat-item:not(.kv-cache-load-chat-item-current)', function() {
        const chatId = $(this).data('chat-id');
        if (chatId) {
            const popupDlg = $(this).closest('.popup, dialog');
            selectLoadPopupChat(chatId, popupDlg.length ? popupDlg[0] : document);
        }
    });
    
    // Обработчик поиска
    $(document).off('input', '#kv-cache-load-search-input').on('input', '#kv-cache-load-search-input', function() {
        const query = $(this).val();
        // Находим popup через closest
        const popupDlg = $(this).closest('.popup, dialog');
        updateSearchQuery(query, popupDlg.length ? popupDlg[0] : document);
    });
}

// Открытие popup загрузки
export async function openLoadPopup() {
    // Получаем список файлов
    const filesList = await getFilesList();
    
    if (!filesList || filesList.length === 0) {
        showToast('warning', 'Не найдено сохранений для загрузки');
        return;
    }
    
    // Группируем файлы по чатам и персонажам
    loadPopupData.chats = groupFilesByChatAndCharacter(filesList);
    // Получаем нормализованный chatId
    loadPopupData.currentChatId = getNormalizedChatId();
    loadPopupData.selectedChatId = null; // Сбрасываем выбранный чат
    loadPopupData.selectedCharacters = {};
    loadPopupData.searchQuery = '';
    
    console.debug('[KV Cache Manager] openLoadPopup:', { 
        filesCount: filesList.length, 
        chatsCount: Object.keys(loadPopupData.chats).length,
        currentChatId: loadPopupData.currentChatId,
        chats: loadPopupData.chats 
    });
    
    // Загружаем HTML-контент из файла
    const popupHTML = await $.get(`${extensionFolderPath}/load-popup.html`);
    
    // Флаг для отслеживания, была ли выполнена загрузка
    let loadPerformed = false;
    
    // Функция для выполнения загрузки
    const performLoad = async () => {
        if (Object.keys(loadPopupData.selectedCharacters).length === 0) {
            showToast('error', 'Персонажи не выбраны');
            return false;
        }
        
        loadPerformed = true;
        await loadSelectedCache();
        return true;
    };
    
    // Вызываем callGenericPopup
    const popupPromise = callGenericPopup(
        popupHTML,
        POPUP_TYPE.TEXT,
        '',
        {
            large: true,
            allowVerticalScrolling: true,
            okButton: 'Загрузить', // Используем стандартную кнопку OK с текстом "Загрузить"
            cancelButton: true, // Показываем стандартную кнопку Cancel
            // Инициализация после открытия popup
            onOpen: async (popup) => {
                // Сохраняем ссылку на popup для использования в других функциях
                loadPopupData.currentPopup = popup;
                
                // Небольшая задержка для гарантии, что DOM готов
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Ищем элементы внутри popup (popup.content - это HTMLElement)
                const popupContent = popup.content.querySelector('#kv-cache-load-popup-content');
                if (!popupContent) {
                    console.error('[KV Cache Manager] Не найден контент popup в', popup.content);
                    return;
                }
                
                console.debug('[KV Cache Manager] Popup открыт, инициализация...', {
                    hasContent: !!popupContent,
                    chatsList: !!popupContent.querySelector('#kv-cache-load-chats-list'),
                    filesList: !!popupContent.querySelector('#kv-cache-load-files-list'),
                    dlg: popup.dlg
                });
                
                setupLoadPopupHandlers();
                
                // Отображаем чаты и файлы (используем popup.dlg как контекст для поиска)
                renderLoadPopupChats(popup.dlg);
                selectLoadPopupChat('current', popup.dlg);
                
                // Изначально отключаем кнопку "Загрузить" (стандартная OK кнопка)
                const loadButton = popup.okButton;
                if (loadButton) {
                    loadButton.disabled = true;
                }
            },
            // Выполняем загрузку перед закрытием popup, если была нажата кнопка "Загрузить"
            onClosing: async (popup) => {
                if (popup.result === POPUP_RESULT.AFFIRMATIVE && !loadPerformed) {
                    // Проверяем, что персонажи выбраны
                    if (Object.keys(loadPopupData.selectedCharacters).length === 0) {
                        showToast('error', 'Персонажи не выбраны');
                        return false; // Отменяем закрытие popup
                    }
                    // Выполняем загрузку
                    await performLoad();
                }
                return true; // Разрешаем закрытие popup
            },
            // Очищаем ссылку на popup при закрытии
            onClose: async (popup) => {
                loadPopupData.currentPopup = null;
            }
        }
    );
    
    // Ждём результат popup
    await popupPromise;
}

// Закрытие popup загрузки (больше не используется, оставлено для совместимости)
export function closeLoadPopup() {
    // Popup теперь закрывается через callGenericPopup
    loadPopupData.selectedCharacters = {};
    loadPopupData.searchQuery = '';
}

// Отображение списка чатов
export function renderLoadPopupChats(context = document) {
    const chatsList = $(context).find("#kv-cache-load-chats-list");
    if (chatsList.length === 0) {
        console.error('[KV Cache Manager] Не найден элемент #kv-cache-load-chats-list в контексте', context);
        return;
    }
    
    const currentChatId = loadPopupData.currentChatId;
    const chats = loadPopupData.chats;
    
    console.debug('[KV Cache Manager] renderLoadPopupChats:', { currentChatId, chatsCount: Object.keys(chats).length, chats });
    
    // Обновляем ID и счетчик для текущего чата
    const currentChatCharacters = chats[currentChatId] || {};
    const currentCount = Object.values(currentChatCharacters).reduce((sum, files) => sum + files.length, 0);
    // Отображаем исходное имя чата (до нормализации) для читаемости
    const rawChatId = getCurrentChatId() || 'unknown';
    $(context).find(".kv-cache-load-chat-item-current .kv-cache-load-chat-name-text").text(rawChatId + ' [текущий]');
    $(context).find(".kv-cache-load-chat-item-current .kv-cache-load-chat-count").text(currentCount > 0 ? currentCount : '-');
    
    // Фильтруем чаты по поисковому запросу
    const searchQuery = loadPopupData.searchQuery.toLowerCase();
    const filteredChats = Object.keys(chats).filter(chatId => {
        if (chatId === currentChatId) return true;
        if (searchQuery && !chatId.toLowerCase().includes(searchQuery)) return false;
        return true;
    });
    
    // Очищаем список
    chatsList.empty();
    
    // Добавляем другие чаты
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

// Выбор чата в popup
export function selectLoadPopupChat(chatId, context = document) {
    // Убираем активный класс со всех чатов
    $(context).find(".kv-cache-load-chat-item").removeClass('active');
    
    // Устанавливаем активный класс и сохраняем выбранный чат
    if (chatId === 'current') {
        $(context).find(".kv-cache-load-chat-item-current").addClass('active');
        chatId = loadPopupData.currentChatId;
    } else {
        $(context).find(`.kv-cache-load-chat-item[data-chat-id="${chatId}"]`).addClass('active');
    }
    
    // Сохраняем выбранный чат для использования при загрузке
    loadPopupData.selectedChatId = chatId;
    
    // Отображаем персонажей выбранного чата
    renderLoadPopupFiles(chatId, context);
    
    // Сбрасываем выбор
    loadPopupData.selectedCharacters = {};
    $(context).find("#kv-cache-load-confirm-button").prop('disabled', true);
    $(context).find("#kv-cache-load-selected-info").text('Персонажи не выбраны');
}

// Отображение персонажей выбранного чата
export function renderLoadPopupFiles(chatId, context = document) {
    const filesList = $(context).find("#kv-cache-load-files-list");
    if (filesList.length === 0) {
        console.error('[KV Cache Manager] Не найден элемент #kv-cache-load-files-list в контексте', context);
        return;
    }
    
    const chats = loadPopupData.chats;
    const chatCharacters = chats[chatId] || {};
    const searchQuery = loadPopupData.searchQuery.toLowerCase();
    
    console.debug('[KV Cache Manager] renderLoadPopupFiles:', { chatId, charactersCount: Object.keys(chatCharacters).length, chatCharacters });
    
    const characterNames = Object.keys(chatCharacters);
    
    if (characterNames.length === 0) {
        filesList.html('<div class="kv-cache-load-empty">Нет файлов для этого чата</div>');
        return;
    }
    
    // Фильтруем персонажей по поисковому запросу
    const filteredCharacters = characterNames.filter(characterName => {
        if (!searchQuery) return true;
        return characterName.toLowerCase().includes(searchQuery);
    });
    
    if (filteredCharacters.length === 0) {
        filesList.html('<div class="kv-cache-load-empty">Не найдено персонажей по запросу</div>');
        return;
    }
    
    // Сортируем персонажей: сначала те, что распределены в слоты (только для текущего чата)
    const isCurrentChat = chatId === loadPopupData.currentChatId;
    if (isCurrentChat) {
        // Создаем Set нормализованных имен из слотов для корректного сравнения
        const slotsState = getSlotsState();
        const slotsCharacters = new Set(
            slotsState
                .map(slot => slot?.characterName)
                .filter(name => name && typeof name === 'string')
        );
        
        filteredCharacters.sort((a, b) => {
            // Имена из файлов уже нормализованы, но на всякий случай
            const aInSlots = slotsCharacters.has(a);
            const bInSlots = slotsCharacters.has(b);
            
            // Персонажи в слотах идут первыми
            if (aInSlots && !bInSlots) return -1;
            if (!aInSlots && bInSlots) return 1;
            
            // Если оба в слотах или оба не в слотах, сохраняем исходный порядок
            return 0;
        });
    }
    
    filesList.empty();
    
    // Отображаем персонажей с их timestamp
    for (const characterName of filteredCharacters) {
        const characterFiles = chatCharacters[characterName];
        
        const characterElement = $(`
            <div class="kv-cache-load-file-group collapsed" data-character-name="${characterName}">
                <div class="kv-cache-load-file-group-header">
                    <div class="kv-cache-load-file-group-title">
                        <i class="fa-solid fa-user"></i>
                        ${characterName}
                    </div>
                    <div class="kv-cache-load-file-group-info">
                        <span>${characterFiles.length} сохранени${characterFiles.length !== 1 ? 'й' : 'е'}</span>
                        <i class="fa-solid fa-chevron-down kv-cache-load-file-group-toggle"></i>
                    </div>
                </div>
                <div class="kv-cache-load-file-group-content">
                </div>
            </div>
        `);
        
        // Добавляем timestamp для этого персонажа
        const content = characterElement.find('.kv-cache-load-file-group-content');
        for (const file of characterFiles) {
            const dateTime = formatTimestampToDate(file.timestamp);
            const tagLabel = file.tag ? ` [тег: ${file.tag}]` : '';
            
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
            
            // Проверяем, является ли это сохранение выбранным
            const isSelected = loadPopupData.selectedCharacters[characterName] === file.timestamp;
            if (isSelected) {
                timestampItem.addClass('selected');
            }
            
            timestampItem.on('click', function(e) {
                e.stopPropagation();
                
                // Проверяем, является ли этот элемент уже выбранным
                const isCurrentlySelected = loadPopupData.selectedCharacters[characterName] === file.timestamp;
                
                if (isCurrentlySelected) {
                    // Снимаем выделение - убираем класс и удаляем из selectedCharacters
                    timestampItem.removeClass('selected');
                    delete loadPopupData.selectedCharacters[characterName];
                } else {
                    // Убираем выделение с других сохранений этого персонажа
                    $(`.kv-cache-load-file-item[data-character-name="${characterName}"]`).removeClass('selected');
                    
                    // Выделяем выбранное сохранение
                    timestampItem.addClass('selected');
                    
                    // Выбираем этот timestamp для персонажа
                    const selectedTimestamp = file.timestamp;
                    loadPopupData.selectedCharacters[characterName] = selectedTimestamp;
                }
                
                // Обновляем UI (находим popup через closest)
                const popupDlg = timestampItem.closest('.popup, dialog');
                updateLoadPopupSelection(popupDlg.length ? popupDlg[0] : document);
            });
            
            content.append(timestampItem);
        }
        
        // Обработчик сворачивания/разворачивания
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

// Обновление информации о выбранных персонажах
export function updateLoadPopupSelection(context = document) {
    const selectedCount = Object.keys(loadPopupData.selectedCharacters).length;
    const selectedInfo = $(context).find("#kv-cache-load-selected-info");
    
    if (selectedInfo.length === 0) {
        return; // Popup не открыт
    }
    
    // Используем popup.okButton для управления кнопкой
    const loadButton = loadPopupData.currentPopup?.okButton;
    
    if (selectedCount === 0) {
        selectedInfo.text('Персонажи не выбраны');
        // Отключаем кнопку "Загрузить" если она есть
        if (loadButton) {
            loadButton.disabled = true;
        }
    } else {
        const charactersList = Object.keys(loadPopupData.selectedCharacters).join(', ');
        selectedInfo.html(`<strong>Выбрано:</strong> ${selectedCount} персонаж${selectedCount !== 1 ? 'ей' : ''} (${charactersList})`);
        // Включаем кнопку "Загрузить"
        if (loadButton) {
            loadButton.disabled = false;
        }
    }
}

// Загрузка выбранного кеша
export async function loadSelectedCache() {
    const selectedCharacters = loadPopupData.selectedCharacters;
    
    if (!selectedCharacters || Object.keys(selectedCharacters).length === 0) {
        showToast('error', 'Персонажи не выбраны');
        return;
    }
    
    // Используем выбранный чат из popup, если он был выбран, иначе используем текущий
    const selectedChatId = loadPopupData.selectedChatId || loadPopupData.currentChatId || getNormalizedChatId();
    const chats = loadPopupData.chats;
    const chatCharacters = chats[selectedChatId] || {};
    
    let loadedCount = 0;
    let errors = [];
    
    // Проверяем, что не выбрано больше персонажей, чем доступно слотов
    const selectedCount = Object.keys(selectedCharacters).length;
    const slotsState = getSlotsState();
    const totalSlots = slotsState.length;
    
    if (selectedCount > totalSlots) {
        showToast('error', `Выбрано ${selectedCount} персонажей, но доступно только ${totalSlots} слотов. Выберите не более ${totalSlots} персонажей.`);
        return;
    }
    
    showToast('info', `Начинаю загрузку кешей для ${Object.keys(selectedCharacters).length} персонажей...`, 'Загрузка');
    
    const extensionSettings = getExtensionSettings();
    
    // Шаг 1: Подготавливаем данные о выбранных персонажах и создаем Set защищенных персонажей
    // Имена персонажей уже нормализованы в groupFilesByChatAndCharacter()
    const charactersToLoad = [];
    const protectedCharactersSet = new Set(); // Нормализованные имена всех выбранных персонажей
    
    for (const characterName in selectedCharacters) {
        const selectedTimestamp = selectedCharacters[characterName];
        const characterFiles = chatCharacters[characterName] || [];
        const fileToLoad = characterFiles.find(f => f.timestamp === selectedTimestamp);
        
        if (!fileToLoad) {
            errors.push(`${characterName}: файл не найден`);
            continue;
        }
        
        protectedCharactersSet.add(characterName);
        charactersToLoad.push({
            characterName: characterName,
            fileToLoad: fileToLoad
        });
    }
    
    if (charactersToLoad.length === 0) {
        showToast('error', 'Не найдено файлов для загрузки');
        return;
    }
    
    // Шаг 2: Распределяем всех выбранных персонажей по слотам
    // Используем acquireSlot() с защищенными персонажами, чтобы они не вытесняли друг друга
    // Имена персонажей уже нормализованы
    const characterSlotMap = new Map(); // { characterName: slotIndex }
    
    for (const character of charactersToLoad) {
        try {
            // acquireSlot() автоматически проверит, есть ли персонаж уже в слоте,
            // и если нет - найдет свободный слот или вытеснит незащищенного персонажа
            const slotIndex = await acquireSlot(character.characterName, MIN_USAGE_FOR_SAVE, protectedCharactersSet);
            
            if (slotIndex === null) {
                errors.push(`${character.characterName}: не удалось получить слот`);
                continue;
            }
            
            characterSlotMap.set(character.characterName, slotIndex);
            console.debug(`[KV Cache Manager] Персонаж ${character.characterName} распределен в слот ${slotIndex}`);
        } catch (e) {
            console.error(`[KV Cache Manager] Ошибка при распределении персонажа ${character.characterName}:`, e);
            errors.push(`${character.characterName}: ${e.message}`);
        }
    }
    
    // Шаг 3: Загружаем кеши для всех персонажей
    for (const character of charactersToLoad) {
        const slotIndex = characterSlotMap.get(character.characterName);
        
        if (slotIndex === undefined) {
            // Ошибка уже добавлена на шаге 2
            continue;
        }
        
        try {
            // Загружаем кеш
            const loaded = await loadSlotCache(slotIndex, character.fileToLoad.filename);
            
            if (loaded) {
                loadedCount++;
                console.debug(`[KV Cache Manager] Загружен кеш для персонажа ${character.characterName} в слот ${slotIndex}`);
                
                // Парсим имя файла один раз для получения информации о чате
                const parsed = parseSaveFilename(character.fileToLoad.filename);
                
                // Форматируем дату-время из timestamp для тоста
                const dateTimeStr = formatTimestampToDate(character.fileToLoad.timestamp);
                
                // Показываем информацию о чате, если кеш загружен из другого чата
                const currentChatId = getNormalizedChatId();
                const cacheChatId = parsed?.chatId;
                const chatInfo = cacheChatId && cacheChatId !== currentChatId ? ` (из чата ${cacheChatId})` : '';
                
                // Выводим тост для каждого успешно загруженного персонажа
                if (extensionSettings.showNotifications) {
                    showToast('success', `Загружен кеш для ${character.characterName} (${dateTimeStr})${chatInfo}`, 'Загрузка кеша');
                }
            } else {
                errors.push(`${character.characterName}: ошибка загрузки`);
            }
        } catch (e) {
            console.error(`[KV Cache Manager] Ошибка при загрузке кеша для персонажа ${character.characterName}:`, e);
            errors.push(`${character.characterName}: ${e.message}`);
        }
    }
    
    // Показываем результат
    if (loadedCount > 0) {
        if (errors.length > 0) {
            showToast('warning', `Загружено ${loadedCount} из ${Object.keys(selectedCharacters).length} персонажей. Ошибки: ${errors.join(', ')}`, 'Загрузка');
        } else {
            showToast('success', `Успешно загружено ${loadedCount} персонажей`, 'Загрузка');
        }
        
        // Обновляем список слотов (loadSlotCache() уже обновляет после каждой загрузки, но финальное обновление гарантирует актуальность)
        updateSlotsList();
    } else {
        showToast('error', `Не удалось загрузить кеши. Ошибки: ${errors.join(', ')}`, 'Загрузка');
    }
}

// Обновление поискового запроса
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
        // Обновляем выбранный чат при поиске
        loadPopupData.selectedChatId = currentChatId;
        renderLoadPopupFiles(currentChatId, context);
    }
}
