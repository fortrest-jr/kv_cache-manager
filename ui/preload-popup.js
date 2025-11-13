// Popup предзагрузки для KV Cache Manager

import { getContext } from "../../../../extensions.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../../scripts/popup.js';

import { showToast } from './ui.js';
import { extensionFolderPath } from '../settings.js';
import { getChatCharactersWithMutedStatus } from '../utils/character-utils.js';

// Глобальные переменные для popup предзагрузки
let preloadPopupData = {
    characters: [], // Массив персонажей с информацией о мьюте
    selectedCharacters: new Set(), // Set нормализованных имен выбранных персонажей
    searchQuery: '',
    currentPopup: null // Ссылка на текущий открытый popup
};

// Настройка обработчиков событий для popup
function setupPreloadPopupHandlers() {
    // Обработчик поиска
    $(document).off('input', '#kv-cache-preload-search-input').on('input', '#kv-cache-preload-search-input', function() {
        const query = $(this).val();
        const popupDlg = $(this).closest('.popup, dialog');
        updateSearchQuery(query, popupDlg.length ? popupDlg[0] : document);
    });
    
    // Обработчик чекбокса "Выбрать всех"
    $(document).off('change', '#kv-cache-preload-select-all-checkbox').on('change', '#kv-cache-preload-select-all-checkbox', function() {
        const isChecked = $(this).is(':checked');
        const popupDlg = $(this).closest('.popup, dialog');
        const context = popupDlg.length ? popupDlg[0] : document;
        
        if (isChecked) {
            selectAllCharacters(context);
        } else {
            deselectAllCharacters(context);
        }
    });
}

// Открытие popup предзагрузки
export async function openPreloadPopup() {
    // Получаем список персонажей с информацией о мьюте
    const characters = getChatCharactersWithMutedStatus();
    
    if (!characters || characters.length === 0) {
        showToast('warning', 'Не найдено персонажей для предзагрузки (только для групповых чатов)');
        return null;
    }
    
    // Инициализируем данные popup
    preloadPopupData.characters = characters;
    preloadPopupData.selectedCharacters = new Set();
    preloadPopupData.searchQuery = '';
    
    // По умолчанию выбираем всех немьюченных персонажей
    characters.forEach(char => {
        if (!char.isMuted) {
            preloadPopupData.selectedCharacters.add(char.normalizedName);
        }
    });
    
    console.debug('[KV Cache Manager] openPreloadPopup:', { 
        charactersCount: characters.length,
        selectedCount: preloadPopupData.selectedCharacters.size,
        mutedCount: characters.filter(c => c.isMuted).length,
        characters: characters.map(c => ({
            name: c.name,
            normalizedName: c.normalizedName,
            isMuted: c.isMuted,
            selected: preloadPopupData.selectedCharacters.has(c.normalizedName)
        }))
    });
    
    // Загружаем HTML-контент из файла
    const popupHTML = await $.get(`${extensionFolderPath}/preload-popup.html`);
    
    // Флаг для отслеживания, была ли выполнена предзагрузка
    let preloadPerformed = false;
    
    // Функция для выполнения предзагрузки
    const performPreload = async () => {
        if (preloadPopupData.selectedCharacters.size === 0) {
            showToast('error', 'Персонажи не выбраны');
            return false;
        }
        
        preloadPerformed = true;
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
            okButton: 'Начать предзагрузку',
            cancelButton: true,
            // Инициализация после открытия popup
            onOpen: async (popup) => {
                // Сохраняем ссылку на popup
                preloadPopupData.currentPopup = popup;
                
                // Небольшая задержка для гарантии, что DOM готов
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Ищем элементы внутри popup
                const popupContent = popup.content.querySelector('#kv-cache-preload-popup-content');
                if (!popupContent) {
                    console.error('[KV Cache Manager] Не найден контент popup в', popup.content);
                    return;
                }
                
                console.debug('[KV Cache Manager] Popup предзагрузки открыт, инициализация...', {
                    hasContent: !!popupContent,
                    charactersList: !!popupContent.querySelector('#kv-cache-preload-characters-list')
                });
                
                setupPreloadPopupHandlers();
                
                // Отображаем персонажей
                renderPreloadPopupCharacters(popup.dlg);
                
                // Обновляем информацию о выбранных
                updatePreloadPopupSelection(popup.dlg);
            },
            // Выполняем предзагрузку перед закрытием popup, если была нажата кнопка "Начать предзагрузку"
            onClosing: async (popup) => {
                if (popup.result === POPUP_RESULT.AFFIRMATIVE && !preloadPerformed) {
                    // Проверяем, что персонажи выбраны
                    if (preloadPopupData.selectedCharacters.size === 0) {
                        showToast('error', 'Персонажи не выбраны');
                        return false; // Отменяем закрытие popup
                    }
                    // Разрешаем закрытие, предзагрузка будет выполнена в вызывающем коде
                    return true;
                }
                return true; // Разрешаем закрытие popup
            },
            // Очищаем ссылку на popup при закрытии
            onClose: async (popup) => {
                preloadPopupData.currentPopup = null;
            }
        }
    );
    
    // Ждём результат popup
    const result = await popupPromise;
    
    // Если была нажата кнопка "Начать предзагрузку", возвращаем выбранных персонажей
    if (result === POPUP_RESULT.AFFIRMATIVE) {
        return Array.from(preloadPopupData.selectedCharacters).map(normalizedName => {
            return preloadPopupData.characters.find(c => c.normalizedName === normalizedName);
        }).filter(Boolean);
    }
    
    return null;
}

// Отображение списка персонажей
export function renderPreloadPopupCharacters(context = document) {
    const charactersList = $(context).find("#kv-cache-preload-characters-list");
    if (charactersList.length === 0) {
        console.error('[KV Cache Manager] Не найден элемент #kv-cache-preload-characters-list в контексте', context);
        return;
    }
    
    const characters = preloadPopupData.characters;
    const searchQuery = preloadPopupData.searchQuery.toLowerCase();
    
    console.debug('[KV Cache Manager] renderPreloadPopupCharacters:', { 
        charactersCount: characters.length, 
        searchQuery: searchQuery 
    });
    
    if (characters.length === 0) {
        charactersList.html('<div class="kv-cache-preload-empty">Нет персонажей для предзагрузки</div>');
        return;
    }
    
    // Фильтруем персонажей по поисковому запросу
    const filteredCharacters = characters.filter(character => {
        if (!searchQuery) return true;
        return character.name.toLowerCase().includes(searchQuery) || 
               character.normalizedName.toLowerCase().includes(searchQuery);
    });
    
    if (filteredCharacters.length === 0) {
        charactersList.html('<div class="kv-cache-preload-empty">Не найдено персонажей по запросу</div>');
        return;
    }
    
    charactersList.empty();
    
    // Отображаем персонажей с чекбоксами
    for (const character of filteredCharacters) {
        const isSelected = preloadPopupData.selectedCharacters.has(character.normalizedName);
        const mutedClass = character.isMuted ? 'kv-cache-preload-character-muted' : '';
        
        const characterElement = $(`
            <div class="kv-cache-preload-character-item ${mutedClass}" data-character-name="${character.normalizedName}">
                <label style="display: flex; align-items: center; cursor: pointer; padding: 8px;">
                    <input type="checkbox" 
                           class="kv-cache-preload-character-checkbox" 
                           data-character-name="${character.normalizedName}"
                           ${isSelected ? 'checked' : ''} 
                           style="margin-right: 10px;" />
                    <div style="flex: 1; text-align: left;">
                        <div style="text-align: left;">
                            <i class="fa-solid fa-user" style="margin-right: 5px;"></i>
                            ${character.name}
                        </div>
                        ${character.isMuted ? '<div style="font-size: 0.85em; margin-top: 2px; text-align: left;">(мьючен)</div>' : ''}
                    </div>
                </label>
            </div>
        `);
        
        // Обработчик изменения чекбокса
        characterElement.find('.kv-cache-preload-character-checkbox').on('change', function() {
            const normalizedName = $(this).data('character-name');
            const isChecked = $(this).is(':checked');
            
            if (isChecked) {
                preloadPopupData.selectedCharacters.add(normalizedName);
            } else {
                preloadPopupData.selectedCharacters.delete(normalizedName);
            }
            
            // Обновляем чекбокс "Выбрать всех" в зависимости от состояния всех чекбоксов
            const popupDlg = $(this).closest('.popup, dialog');
            const context = popupDlg.length ? popupDlg[0] : document;
            updateSelectAllCheckbox(context);
            
            // Обновляем UI
            updatePreloadPopupSelection(context);
        });
        
        charactersList.append(characterElement);
    }
    
    // Обновляем чекбокс "Выбрать всех" после рендеринга
    updateSelectAllCheckbox(context);
}

// Обновление чекбокса "Выбрать всех" в зависимости от состояния всех чекбоксов
function updateSelectAllCheckbox(context = document) {
    const allCheckboxes = $(context).find('.kv-cache-preload-character-checkbox');
    const checkedCheckboxes = $(context).find('.kv-cache-preload-character-checkbox:checked');
    const selectAllCheckbox = $(context).find('#kv-cache-preload-select-all-checkbox');
    
    if (allCheckboxes.length === 0) {
        selectAllCheckbox.prop('checked', false);
        selectAllCheckbox.prop('indeterminate', false);
        return;
    }
    
    if (checkedCheckboxes.length === 0) {
        // Ничего не выбрано
        selectAllCheckbox.prop('checked', false);
        selectAllCheckbox.prop('indeterminate', false);
    } else if (checkedCheckboxes.length === allCheckboxes.length) {
        // Все выбраны
        selectAllCheckbox.prop('checked', true);
        selectAllCheckbox.prop('indeterminate', false);
    } else {
        // Частично выбраны
        selectAllCheckbox.prop('checked', false);
        selectAllCheckbox.prop('indeterminate', true);
    }
}

// Обновление информации о выбранных персонажах
export function updatePreloadPopupSelection(context = document) {
    const selectedCount = preloadPopupData.selectedCharacters.size;
    const selectedInfo = $(context).find("#kv-cache-preload-selected-info");
    
    if (selectedInfo.length === 0) {
        return; // Popup не открыт
    }
    
    // Обновляем чекбокс "Выбрать всех"
    updateSelectAllCheckbox(context);
    
    // Используем popup.okButton для управления кнопкой
    const preloadButton = preloadPopupData.currentPopup?.okButton;
    
    if (selectedCount === 0) {
        selectedInfo.text('Персонажи не выбраны');
        // Отключаем кнопку "Начать предзагрузку"
        if (preloadButton) {
            preloadButton.disabled = true;
        }
    } else {
        const selectedNames = Array.from(preloadPopupData.selectedCharacters)
            .map(normalizedName => {
                const char = preloadPopupData.characters.find(c => c.normalizedName === normalizedName);
                return char ? char.name : normalizedName;
            })
            .join(', ');
        
        selectedInfo.html(`<strong>Выбрано:</strong> ${selectedCount} персонаж${selectedCount !== 1 ? 'ей' : ''} (${selectedNames})`);
        // Включаем кнопку "Начать предзагрузку"
        if (preloadButton) {
            preloadButton.disabled = false;
        }
    }
}

// Выбрать всех персонажей (всех видимых, включая мьюченных)
function selectAllCharacters(context = document) {
    // Выбираем всех видимых персонажей (включая мьюченных)
    $(context).find('.kv-cache-preload-character-checkbox').each(function() {
        const normalizedName = $(this).data('character-name');
        if (normalizedName) {
            preloadPopupData.selectedCharacters.add(normalizedName);
            $(this).prop('checked', true);
        }
    });
    
    // Обновляем чекбокс "Выбрать всех"
    updateSelectAllCheckbox(context);
    
    // Обновляем информацию
    updatePreloadPopupSelection(context);
}

// Снять выбор со всех персонажей
function deselectAllCharacters(context = document) {
    preloadPopupData.selectedCharacters.clear();
    
    // Обновляем чекбоксы персонажей (только видимые)
    $(context).find('.kv-cache-preload-character-checkbox').prop('checked', false);
    
    // Обновляем чекбокс "Выбрать всех"
    updateSelectAllCheckbox(context);
    
    // Обновляем информацию
    updatePreloadPopupSelection(context);
}

// Обновление поискового запроса
export function updateSearchQuery(query, context = document) {
    preloadPopupData.searchQuery = query;
    renderPreloadPopupCharacters(context);
    updatePreloadPopupSelection(context);
}

