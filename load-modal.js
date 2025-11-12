// Модальное окно загрузки для KV Cache Manager

import { getNormalizedChatId, normalizeCharacterName, formatTimestampToDate, parseFilesList, sortByTimestamp } from './utils.js';
import { getCurrentChatId } from "../../../../script.js";
import { getFilesList, parseSaveFilename } from './file-manager.js';
import { getSlotsState, acquireSlot, updateSlotsList } from './slot-manager.js';
import { loadSlotCache, saveCharacterCache } from './cache-operations.js';
import { showToast } from './ui.js';
import { getExtensionSettings, extensionFolderPath } from './settings.js';
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../scripts/popup.js';

// Глобальные переменные для модалки загрузки
// Новая структура: { [chatId]: { [characterName]: [{ timestamp, filename, tag }, ...] } }
let loadModalData = {
    chats: {}, // Структура: { [chatId]: { [characterName]: [{ timestamp, filename, tag }, ...] } }
    currentChatId: null, // ID текущего чата (для отображения)
    selectedChatId: null, // ID выбранного чата в модалке (для загрузки)
    selectedCharacters: {}, // { [characterName]: timestamp } - выбранные персонажи и их timestamp
    searchQuery: ''
};

// Группировка файлов по чатам и персонажам
// Возвращает: { [chatId]: { [characterName]: [{ timestamp, filename, tag }, ...] } }
export function groupFilesByChatAndCharacter(files) {
    const chats = {};
    
    // Парсим файлы один раз
    const parsedFiles = parseFilesList(files, parseSaveFilename);
    
    for (const file of parsedFiles) {
        if (!file.parsed) {
            continue;
        }
        
        const chatId = file.parsed.chatId;
        const characterName = file.parsed.characterName || 'Unknown';
        
        if (!chats[chatId]) {
            chats[chatId] = {};
        }
        
        if (!chats[chatId][characterName]) {
            chats[chatId][characterName] = [];
        }
        
        chats[chatId][characterName].push({
            timestamp: file.parsed.timestamp,
            filename: file.name,
            tag: file.parsed.tag || null
        });
    }
    
    // Сортируем timestamp для каждого персонажа (от новых к старым)
    for (const chatId in chats) {
        for (const characterName in chats[chatId]) {
            sortByTimestamp(chats[chatId][characterName]);
        }
    }
    
    return chats;
}

// Настройка обработчиков событий для модалки
function setupLoadModalHandlers() {
    // Обработчик для текущего чата
    $(document).off('click', '.kv-cache-load-chat-item-current').on('click', '.kv-cache-load-chat-item-current', function() {
        selectLoadModalChat('current');
    });
    
    // Обработчик для других чатов (делегирование)
    $(document).off('click', '.kv-cache-load-chat-item:not(.kv-cache-load-chat-item-current)').on('click', '.kv-cache-load-chat-item:not(.kv-cache-load-chat-item-current)', function() {
        const chatId = $(this).data('chat-id');
        if (chatId) {
            selectLoadModalChat(chatId);
        }
    });
    
    // Обработчик поиска
    $(document).off('input', '#kv-cache-load-search-input').on('input', '#kv-cache-load-search-input', function() {
        const query = $(this).val();
        updateSearchQuery(query);
    });
}

// Открытие модалки загрузки
export async function openLoadModal() {
    // Получаем список файлов
    const filesList = await getFilesList();
    
    if (!filesList || filesList.length === 0) {
        showToast('warning', 'Не найдено сохранений для загрузки');
        return;
    }
    
    // Группируем файлы по чатам и персонажам
    loadModalData.chats = groupFilesByChatAndCharacter(filesList);
    // Получаем нормализованный chatId
    loadModalData.currentChatId = getNormalizedChatId();
    loadModalData.selectedChatId = null; // Сбрасываем выбранный чат
    loadModalData.selectedCharacters = {};
    loadModalData.searchQuery = '';
    
    // Загружаем HTML-контент из файла
    const modalHTML = await $.get(`${extensionFolderPath}/load-modal.html`);
    
    // Флаг для отслеживания, была ли выполнена загрузка
    let loadPerformed = false;
    
    // Функция для выполнения загрузки
    const performLoad = async () => {
        if (Object.keys(loadModalData.selectedCharacters).length === 0) {
            showToast('error', 'Персонажи не выбраны');
            return false;
        }
        
        loadPerformed = true;
        await loadSelectedCache();
        return true;
    };
    
    // Вызываем callGenericPopup
    const popupPromise = callGenericPopup(
        modalHTML,
        POPUP_TYPE.TEXT,
        '',
        {
            large: true,
            allowVerticalScrolling: true,
            customButtons: [
                { text: 'Загрузить', result: 'load' },
                { text: 'Отмена', result: POPUP_RESULT.NEGATIVE }
            ]
        }
    );
    
    // Настраиваем обработчики после открытия модалки
    // Используем MutationObserver для отслеживания появления модалки в DOM
    const observer = new MutationObserver((mutations, obs) => {
        const modalContent = $('#kv-cache-load-modal-content');
        if (modalContent.length > 0) {
            obs.disconnect();
            
            setupLoadModalHandlers();
            
            // Отображаем чаты и файлы
            renderLoadModalChats();
            selectLoadModalChat('current');
            
            // Изначально отключаем кнопку "Загрузить"
            const loadButton = $('[data-popup-button-result="load"]');
            if (loadButton.length) {
                loadButton.prop('disabled', true);
            }
            
            // Обработчик для кнопки "Загрузить" через делегирование
            $(document).off('click', '[data-popup-button-result="load"]').on('click', '[data-popup-button-result="load"]', async function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                const button = $(this);
                if (button.prop('disabled')) {
                    return;
                }
                
                await performLoad();
                
                // Закрываем модалку программно после загрузки
                if (loadPerformed) {
                    // Ищем модалку и закрываем её
                    const popup = button.closest('.dialogue_popup');
                    if (popup.length) {
                        // Используем стандартный способ закрытия через кнопку отмены
                        const cancelButton = popup.find(`[data-popup-button-result="${POPUP_RESULT.NEGATIVE}"]`);
                        if (cancelButton.length) {
                            cancelButton.trigger('click');
                        } else {
                            // Fallback - закрываем через кнопку закрытия
                            const closeBtn = popup.find('.dialogue_popup_close');
                            if (closeBtn.length) {
                                closeBtn.trigger('click');
                            }
                        }
                    }
                }
            });
        }
    });
    
    // Начинаем наблюдение за изменениями в DOM
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    // Очищаем observer через 5 секунд, если модалка не появилась
    setTimeout(() => observer.disconnect(), 5000);
    
    // Ждём результат модалки
    const result = await popupPromise;
    
    // Отключаем observer после закрытия модалки
    observer.disconnect();
    
    // Если результат - загрузка и она ещё не была выполнена, выполняем её
    if (result === 'load' && !loadPerformed) {
        await performLoad();
    }
}

// Закрытие модалки загрузки (больше не используется, оставлено для совместимости)
export function closeLoadModal() {
    // Модалка теперь закрывается через callGenericPopup
    loadModalData.selectedCharacters = {};
    loadModalData.searchQuery = '';
}

// Отображение списка чатов
export function renderLoadModalChats() {
    const chatsList = $("#kv-cache-load-chats-list");
    const currentChatId = loadModalData.currentChatId;
    const chats = loadModalData.chats;
    
    // Обновляем ID и счетчик для текущего чата
    const currentChatCharacters = chats[currentChatId] || {};
    const currentCount = Object.values(currentChatCharacters).reduce((sum, files) => sum + files.length, 0);
    // Отображаем исходное имя чата (до нормализации) для читаемости
    const rawChatId = getCurrentChatId() || 'unknown';
    $(".kv-cache-load-chat-item-current .kv-cache-load-chat-name-text").text(rawChatId + ' [текущий]');
    $(".kv-cache-load-chat-item-current .kv-cache-load-chat-count").text(currentCount > 0 ? currentCount : '-');
    
    // Фильтруем чаты по поисковому запросу
    const searchQuery = loadModalData.searchQuery.toLowerCase();
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
        
        chatItem.on('click', () => selectLoadModalChat(chatId));
        chatsList.append(chatItem);
    }
}

// Выбор чата в модалке
export function selectLoadModalChat(chatId) {
    // Убираем активный класс со всех чатов
    $(".kv-cache-load-chat-item").removeClass('active');
    
    // Устанавливаем активный класс и сохраняем выбранный чат
    if (chatId === 'current') {
        $(".kv-cache-load-chat-item-current").addClass('active');
        chatId = loadModalData.currentChatId;
    } else {
        $(`.kv-cache-load-chat-item[data-chat-id="${chatId}"]`).addClass('active');
    }
    
    // Сохраняем выбранный чат для использования при загрузке
    loadModalData.selectedChatId = chatId;
    
    // Отображаем персонажей выбранного чата
    renderLoadModalFiles(chatId);
    
    // Сбрасываем выбор
    loadModalData.selectedCharacters = {};
    $("#kv-cache-load-confirm-button").prop('disabled', true);
    $("#kv-cache-load-selected-info").text('Персонажи не выбраны');
}

// Отображение персонажей выбранного чата
export function renderLoadModalFiles(chatId) {
    const filesList = $("#kv-cache-load-files-list");
    const chats = loadModalData.chats;
    const chatCharacters = chats[chatId] || {};
    const searchQuery = loadModalData.searchQuery.toLowerCase();
    
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
    const isCurrentChat = chatId === loadModalData.currentChatId;
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
            const isSelected = loadModalData.selectedCharacters[characterName] === file.timestamp;
            if (isSelected) {
                timestampItem.addClass('selected');
            }
            
            timestampItem.on('click', function(e) {
                e.stopPropagation();
                
                // Убираем выделение с других сохранений этого персонажа
                $(`.kv-cache-load-file-item[data-character-name="${characterName}"]`).removeClass('selected');
                
                // Выделяем выбранное сохранение
                timestampItem.addClass('selected');
                
                // Выбираем этот timestamp для персонажа
                const selectedTimestamp = file.timestamp;
                loadModalData.selectedCharacters[characterName] = selectedTimestamp;
                
                // Обновляем UI
                updateLoadModalSelection();
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
export function updateLoadModalSelection() {
    const selectedCount = Object.keys(loadModalData.selectedCharacters).length;
    const selectedInfo = $("#kv-cache-load-selected-info");
    
    if (selectedInfo.length === 0) {
        return; // Модалка не открыта
    }
    
    if (selectedCount === 0) {
        selectedInfo.text('Персонажи не выбраны');
        // Отключаем кнопку "Загрузить" если она есть
        const loadButton = $('[data-popup-button-result="load"]');
        if (loadButton.length) {
            loadButton.prop('disabled', true);
        }
    } else {
        const charactersList = Object.keys(loadModalData.selectedCharacters).join(', ');
        selectedInfo.html(`<strong>Выбрано:</strong> ${selectedCount} персонаж${selectedCount !== 1 ? 'ей' : ''} (${charactersList})`);
        // Включаем кнопку "Загрузить"
        const loadButton = $('[data-popup-button-result="load"]');
        if (loadButton.length) {
            loadButton.prop('disabled', false);
        }
    }
}

// Получение последнего кеша для персонажа
// @param {string} characterName - Нормализованное имя персонажа
// @param {boolean} currentChatOnly - искать только в текущем чате (по умолчанию true)
export async function getLastCacheForCharacter(characterName, currentChatOnly = true) {
    try {
        const filesList = await getFilesList();
        if (!filesList || filesList.length === 0) {
            return null;
        }
        
        // characterName уже должен быть нормализован, но нормализуем для безопасности
        const normalizedCharacterName = normalizeCharacterName(characterName);
        
        // Получаем chatId текущего чата для фильтрации (если нужно)
        const currentChatId = currentChatOnly ? getNormalizedChatId() : null;
        
        // Парсим файлы один раз и фильтруем
        const parsedFiles = parseFilesList(filesList, parseSaveFilename);
        
        // Ищем файлы, содержащие имя персонажа
        const characterFiles = [];
        
        for (const file of parsedFiles) {
            if (!file.parsed) {
                continue;
            }
            
            // Фильтруем по чату, если нужно
            if (currentChatOnly && file.parsed.chatId !== currentChatId) {
                continue;
            }
            
            // Проверяем по characterName в имени файла (основной способ для режима групповых чатов)
            if (file.parsed.characterName) {
                const normalizedParsedName = normalizeCharacterName(file.parsed.characterName);
                if (normalizedParsedName === normalizedCharacterName) {
                    characterFiles.push({
                        filename: file.name,
                        timestamp: file.parsed.timestamp,
                        chatId: file.parsed.chatId
                    });
                    continue; // Найден по characterName, не нужно проверять fallback
                }
            }
            
            // Также проверяем по имени файла (fallback, менее надежный способ)
            if (file.name.includes(normalizedCharacterName) || file.name.includes(characterName)) {
                // Убеждаемся, что это не дубликат
                const alreadyAdded = characterFiles.some(f => f.filename === file.name);
                if (!alreadyAdded) {
                    characterFiles.push({
                        filename: file.name,
                        timestamp: file.parsed.timestamp,
                        chatId: file.parsed.chatId
                    });
                }
            }
        }
        
        if (characterFiles.length === 0) {
            console.debug(`[KV Cache Manager] Не найдено кеша для персонажа ${characterName}${currentChatOnly ? ` в чате ${currentChatId}` : ''}`);
            return null;
        }
        
        // Сортируем по timestamp (от новых к старым)
        sortByTimestamp(characterFiles);
        
        // Возвращаем самый последний файл
        const lastFile = characterFiles[0];
        console.debug(`[KV Cache Manager] Найден последний кеш для персонажа ${characterName}: ${lastFile.filename}${currentChatOnly ? ` (в текущем чате)` : ' (во всех чатах)'}`);
        
        return {
            filename: lastFile.filename,
        };
    } catch (e) {
        console.error(`[KV Cache Manager] Ошибка при поиске кеша для персонажа ${characterName}:`, e);
        return null;
    }
}

// Загрузка выбранного кеша
export async function loadSelectedCache() {
    const selectedCharacters = loadModalData.selectedCharacters;
    
    if (!selectedCharacters || Object.keys(selectedCharacters).length === 0) {
        showToast('error', 'Персонажи не выбраны');
        return;
    }
    
    // Используем выбранный чат из модалки, если он был выбран, иначе используем текущий
    const selectedChatId = loadModalData.selectedChatId || loadModalData.currentChatId || getNormalizedChatId();
    const chats = loadModalData.chats;
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
    const MIN_USAGE_FOR_SAVE = 2;
    
    // Загружаем кеши для каждого выбранного персонажа
    for (const characterName in selectedCharacters) {
        const selectedTimestamp = selectedCharacters[characterName];
        const characterFiles = chatCharacters[characterName] || [];
        
        // Находим файл с выбранным timestamp
        const fileToLoad = characterFiles.find(f => f.timestamp === selectedTimestamp);
        
        if (!fileToLoad) {
            errors.push(`${characterName}: файл не найден`);
            continue;
        }
        
        try {
            let slotIndex = null;
            
            // Проверяем, есть ли персонаж в слотах (сравниваем нормализованные имена)
            const normalizedName = normalizeCharacterName(characterName);
            slotIndex = slotsState.findIndex(slot => {
                const slotName = slot?.characterName;
                return slotName && normalizeCharacterName(slotName) === normalizedName;
            });
            
            if (slotIndex !== -1) {
                // Персонаж уже в слотах - загружаем кеш в существующий слот
                console.debug(`[KV Cache Manager] Персонаж ${characterName} уже в слоте ${slotIndex}, загружаю кеш в этот же слот`);
            } else {
                // Персонаж не в слотах - выделяем новый слот по общей логике (ручная загрузка, не генерация - счетчик = 0)
                console.debug(`[KV Cache Manager] Персонаж ${characterName} не в слотах, выделяю новый слот для загрузки кеша`);
                console.debug(`[KV Cache Manager] Текущие слоты:`, slotsState);
                slotIndex = await acquireSlot(normalizedName, MIN_USAGE_FOR_SAVE);
                
                if (slotIndex === null) {
                    errors.push(`${characterName}: не удалось получить слот`);
                    continue;
                }
                
                console.debug(`[KV Cache Manager] Персонаж ${characterName} помещен в слот ${slotIndex}`);
            }
            
            // Загружаем кеш
            const loaded = await loadSlotCache(slotIndex, fileToLoad.filename);
            
            if (loaded) {
                loadedCount++;
                console.debug(`[KV Cache Manager] Загружен кеш для персонажа ${characterName} в слот ${slotIndex}`);
                
                // Парсим имя файла один раз для получения информации о чате
                const parsed = parseSaveFilename(fileToLoad.filename);
                
                // Форматируем дату-время из timestamp для тоста
                const dateTimeStr = formatTimestampToDate(fileToLoad.timestamp);
                
                // Показываем информацию о чате, если кеш загружен из другого чата
                const currentChatId = getNormalizedChatId();
                const cacheChatId = parsed?.chatId;
                const chatInfo = cacheChatId && cacheChatId !== currentChatId ? ` (из чата ${cacheChatId})` : '';
                
                // Выводим тост для каждого успешно загруженного персонажа
                if (extensionSettings.showNotifications) {
                    showToast('success', `Загружен кеш для ${characterName} (${dateTimeStr})${chatInfo}`, 'Загрузка кеша');
                }
            } else {
                errors.push(`${characterName}: ошибка загрузки`);
            }
        } catch (e) {
            console.error(`[KV Cache Manager] Ошибка при загрузке кеша для персонажа ${characterName}:`, e);
            errors.push(`${characterName}: ${e.message}`);
        }
    }
    
    // Показываем результат
    if (loadedCount > 0) {
        if (errors.length > 0) {
            showToast('warning', `Загружено ${loadedCount} из ${Object.keys(selectedCharacters).length} персонажей. Ошибки: ${errors.join(', ')}`, 'Загрузка');
        } else {
            showToast('success', `Успешно загружено ${loadedCount} персонажей`, 'Загрузка');
        }
        
        // Обновляем список слотов
        setTimeout(() => updateSlotsList(), 1000);
    } else {
        showToast('error', `Не удалось загрузить кеши. Ошибки: ${errors.join(', ')}`, 'Загрузка');
    }
}

// Обновление поискового запроса
export function updateSearchQuery(query) {
    loadModalData.searchQuery = query;
    renderLoadModalChats();
    const activeChat = $(".kv-cache-load-chat-item.active");
    const activeCurrentChat = $(".kv-cache-load-chat-item-current.active");
    
    let currentChatId = null;
    if (activeChat.length) {
        currentChatId = activeChat.data('chat-id');
    } else if (activeCurrentChat.length) {
        currentChatId = loadModalData.currentChatId;
    }
    
    if (currentChatId) {
        // Обновляем выбранный чат при поиске
        loadModalData.selectedChatId = currentChatId;
        renderLoadModalFiles(currentChatId);
    }
}
