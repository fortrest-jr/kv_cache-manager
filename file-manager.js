// Управление файлами кеша для KV Cache Manager

import FilePluginApi from './file-plugin-api.js';
import { normalizeChatId, normalizeCharacterName, normalizeString, getNormalizedChatId, parseFilesList, sortByTimestamp } from './utils.js';

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
export async function getFilesList(callbacks = {}) {
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
        if (callbacks.onShowToast) {
            callbacks.onShowToast('error', 'Ошибка получения списка файлов: ' + e.message);
        }
        return [];
    }
}

// Удаление файла
export async function deleteFile(filename) {
    try {
        await filePluginApi.deleteFile(filename);
        
        console.debug(`[KV Cache Manager] Файл удален: ${filename}`);
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
export async function rotateFiles(filterFn, description, context, options = {}) {
    const { maxFiles, showNotifications, onShowToast } = options;
    const chatId = getNormalizedChatId();
    
    try {
        // Получаем список всех файлов
        const filesList = await getFilesList({ onShowToast });
        
        // Парсим файлы один раз и фильтруем
        const filteredFiles = parseFilesList(filesList, parseSaveFilename).filter(filterFn);
        
        console.debug(`[KV Cache Manager] Найдено ${filteredFiles.length} автосохранений ${description} (лимит: ${maxFiles})`);
        
        // Сортируем по timestamp (от новых к старым)
        sortByTimestamp(filteredFiles);
        
        if (filteredFiles.length > maxFiles) {
            const filesToDelete = filteredFiles.slice(maxFiles);
            console.debug(`[KV Cache Manager] Удаление ${filesToDelete.length} старых автосохранений ${description}`);
            
            let deletedCount = 0;
            for (const file of filesToDelete) {
                const deleted = await deleteFile(file.name);
                if (deleted) {
                    deletedCount++;
                    console.debug(`[KV Cache Manager] Удален файл: ${file.name}`);
                }
            }
            
            if (deletedCount > 0 && showNotifications && onShowToast) {
                onShowToast('warning', `Удалено ${deletedCount} старых автосохранений ${description}`, 'Ротация файлов');
            }
        } else {
            console.debug(`[KV Cache Manager] Ротация не требуется ${context}: ${filteredFiles.length} файлов <= ${maxFiles}`);
        }
    } catch (e) {
        console.error(`[KV Cache Manager] Ошибка при ротации файлов ${context}:`, e);
    }
}

// Ротация файлов для конкретного персонажа
export async function rotateCharacterFiles(characterName, options = {}) {
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
        `для ${characterName}`,
        options
    );
}

