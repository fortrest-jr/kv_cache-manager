// Управление файлами кеша для KV Cache Manager

import FilePluginApi from '../api/file-plugin-api.js';
import { normalizeChatId, normalizeCharacterName, normalizeString, getNormalizedChatId, parseFilesList, sortByTimestamp } from '../utils/utils.js';
import { showToast } from '../ui/ui.js';
import { getExtensionSettings, MIN_FILE_SIZE_MB, FILE_CHECK_DELAY_MS } from '../settings.js';

// Инициализация API клиента
const filePluginApi = new FilePluginApi();

// Генерация имени файла в едином формате
// Форматы:
// - Автосохранение: {chatId}_{timestamp}_character_{characterName}.bin
// - С тегом: {chatId}_{timestamp}_tag_{tag}_character_{characterName}.bin
// @param {string} chatId - ID чата
// @param {string} timestamp - временная метка
// @param {string} characterName - имя персонажа (обязательно)
// @param {string} tag - тег для ручного сохранения (опционально)
export function generateSaveFilename(chatId, timestamp, characterName, tag = null) {
    const safeChatId = normalizeChatId(chatId);
    const safeCharacterName = characterName;
    
    // Ручное сохранение с тегом
    if (tag) {
        const safeTag = normalizeString(tag);
        return `${safeChatId}_${timestamp}_tag_${safeTag}_character_${safeCharacterName}.bin`;
    }
    
    // Автосохранение (без тега)
    return `${safeChatId}_${timestamp}_character_${safeCharacterName}.bin`;
}

// Парсинг имени файла для извлечения данных
// Поддерживает форматы:
// - Автосохранение: {chatId}_{timestamp}_character_{characterName}.bin
// - С тегом: {chatId}_{timestamp}_tag_{tag}_character_{characterName}.bin
// Также поддерживает старый формат для обратной совместимости:
// - {chatId}_{timestamp}_tag_{tag}_slot{slotId}.bin
// - {chatId}_{timestamp}_slot{slotId}.bin
// Возвращает { chatId, timestamp, tag, slotId, characterName } или null при ошибке
export function parseSaveFilename(filename) {
    // Убираем расширение .bin
    const nameWithoutExt = filename.replace(/\.bin$/, '');
    
    let tag = null;
    let characterName = null;
    let beforeSuffix = nameWithoutExt;
    
    // Проверяем новый формат: _character_{characterName} (всегда в конце)
    const characterMatch = nameWithoutExt.match(/_character_(.+)$/);
    if (!characterMatch) {
        return null;
    }
    characterName = characterMatch[1];
    beforeSuffix = nameWithoutExt.slice(0, -characterMatch[0].length);
    
    // Проверяем наличие _tag_{tag} перед _character
    const tagMatch = beforeSuffix.match(/_tag_(.+)$/);
    if (tagMatch) {
        tag = tagMatch[1];
        beforeSuffix = beforeSuffix.slice(0, -tagMatch[0].length);
    }
    
    // Ищем timestamp (14 цифр) с конца
    const timestampMatch = beforeSuffix.match(/_(\d{14})$/);
    if (!timestampMatch) {
        return null;
    }
    
    const timestamp = timestampMatch[1];
    const chatId = beforeSuffix.slice(0, -timestampMatch[0].length);
    
    return {
        chatId: chatId,
        timestamp: timestamp,
        tag: tag,
        characterName: characterName
    };
}

// Получение списка файлов через API плагина kv_cache-manager-plugin
// Все файлы считываются напрямую из папки сохранений, метаданные не используются
export async function getFilesList() {
    try {
        // Обращаемся к API плагина для получения списка файлов
        const data = await filePluginApi.getFilesList();
        
        if (data) {
            // Фильтруем только .bin файлы и не директории
            const binFiles = (data.files || []).filter(file => 
                file.name.endsWith('.bin') && !file.isDirectory
            );
            // Возвращаем объекты с именем и размером
            return binFiles.map(file => ({
                name: file.name,
                size: file.size || 0
            }));
        }
        
        return [];
    } catch (e) {
        console.error('[KV Cache Manager] Ошибка получения списка файлов:', e);
        showToast('error', 'Ошибка получения списка файлов: ' + e.message);
        return [];
    }
}

// Удаление файла
export async function deleteFile(filename) {
    try {
        await filePluginApi.deleteFile(filename);
        return true;
    } catch (e) {
        console.warn(`[KV Cache Manager] Ошибка при удалении файла ${filename}:`, e);
        return false;
    }
}

// Общая функция ротации файлов
// @param {Function} filterFn - функция фильтрации файлов: (file) => boolean
// @param {string} description - описание для логов и уведомлений (например, "для персонажа CharacterName" или "для чата")
// @param {string} context - контекст для логов (например, "персонажа CharacterName" или "чата")
export async function rotateFiles(filterFn, description, context) {
    const extensionSettings = getExtensionSettings();
    const maxFiles = extensionSettings.maxFiles || 10;
    const chatId = getNormalizedChatId();
    
    try {
        // Получаем список всех файлов
        const filesList = await getFilesList();
        
        // Парсим файлы один раз и фильтруем
        const filteredFiles = parseFilesList(filesList, parseSaveFilename).filter(filterFn);
        
        // Сортируем по timestamp (от новых к старым)
        sortByTimestamp(filteredFiles);
        
        if (filteredFiles.length > maxFiles) {
            const filesToDelete = filteredFiles.slice(maxFiles);
            
            let deletedCount = 0;
            for (const file of filesToDelete) {
                const deleted = await deleteFile(file.name);
                if (deleted) {
                    deletedCount++;
                }
            }
            
            if (deletedCount > 0 && extensionSettings.showNotifications) {
                showToast('warning', `Удалено ${deletedCount} старых автосохранений ${description}`, 'Ротация файлов');
            }
        }
    } catch (e) {
        console.error(`[KV Cache Manager] Ошибка при ротации файлов ${context}:`, e);
    }
}

// Ротация файлов для конкретного персонажа
export async function rotateCharacterFiles(characterName) {
    if (!characterName) {
        return;
    }
    
    // characterName уже должен быть нормализован, но нормализуем для безопасности
    const normalizedName = normalizeCharacterName(characterName);
    const chatId = getNormalizedChatId();
    
    await rotateFiles(
        (file) => {
            if (!file.parsed) return false;
            const parsedNormalizedName = normalizeCharacterName(file.parsed.characterName || '');
            return file.parsed.chatId === chatId && 
                   parsedNormalizedName === normalizedName &&
                   !file.parsed.tag; // Только автосохранения (без тега)
        },
        `для персонажа ${characterName} в чате ${chatId}`,
        `для ${characterName}`
    );
}

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
            return null;
        }
        
        // Сортируем по timestamp (от новых к старым)
        sortByTimestamp(characterFiles);
        
        // Возвращаем самый последний файл
        const lastFile = characterFiles[0];
        
        return {
            filename: lastFile.filename,
        };
    } catch (e) {
        console.error(`[KV Cache Manager] Ошибка при поиске кеша для персонажа ${characterName}:`, e);
        return null;
    }
}

// Валидация размера сохраненного файла кеша
// @param {string} filename - Имя файла для проверки
// @param {string} characterName - Имя персонажа (для уведомлений)
// @returns {Promise<boolean>} - true если файл валиден, false если файл слишком мал и был удален
export async function validateCacheFile(filename, characterName) {
    try {
        // Ждем немного, чтобы файл точно был сохранен на сервере
        await new Promise(resolve => setTimeout(resolve, FILE_CHECK_DELAY_MS));
        
        const filesList = await getFilesList();
        const savedFile = filesList.find(file => file.name === filename);
        
        if (savedFile) {
            const fileSizeMB = savedFile.size / (1024 * 1024); // Размер в мегабайтах
            
            if (fileSizeMB < MIN_FILE_SIZE_MB) {
                // Файл меньше минимального размера - считаем невалидным и удаляем
                console.warn(`[KV Cache Manager] Файл ${filename} слишком мал (${fileSizeMB.toFixed(2)} МБ), удаляем как невалидный`);
                await deleteFile(filename);
                showToast('warning', `Файл кеша для ${characterName} слишком мал, не сохранён`);
                return false;
            }
        }
        
        return true;
    } catch (e) {
        console.warn(`[KV Cache Manager] Не удалось проверить размер файла ${filename}:`, e);
        // Продолжаем, даже если не удалось проверить размер
        return true;
    }
}

