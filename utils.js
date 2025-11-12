// Утилиты и вспомогательные функции для KV Cache Manager

import { getCurrentChatId } from "../../../../script.js";

// Получение количества слотов из ответа /slots
export function getSlotsCountFromData(slotsData) {
    if (Array.isArray(slotsData)) {
        return slotsData.length;
    } else if (typeof slotsData === 'object' && slotsData !== null) {
        return Object.keys(slotsData).length;
    }
    return 0;
}

// Формирование timestamp для имени файла (YYYYMMDDHHMMSS)
export function formatTimestamp(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hour}${minute}${second}`;
}

// Общая функция нормализации строк для использования в именах файлов и сравнениях
// Заменяет все недопустимые символы (включая пробелы) на подчеркивания
export function normalizeString(str, defaultValue = '') {
    if (!str && str !== 0) {
        return defaultValue;
    }
    return String(str).replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Нормализация chatId для использования в именах файлов и сравнениях
export function normalizeChatId(chatId) {
    return normalizeString(chatId, 'unknown');
}

// Получение нормализованного chatId текущего чата
export function getNormalizedChatId() {
    return normalizeChatId(getCurrentChatId());
}

// Нормализация имени персонажа для использования в именах файлов и сравнениях
export function normalizeCharacterName(characterName) {
    return normalizeString(characterName, '');
}

// Форматирование даты и времени из timestamp
export function formatTimestampToDate(timestamp) {
    const date = new Date(
        parseInt(timestamp.substring(0, 4)), // год
        parseInt(timestamp.substring(4, 6)) - 1, // месяц (0-based)
        parseInt(timestamp.substring(6, 8)), // день
        parseInt(timestamp.substring(8, 10)), // час
        parseInt(timestamp.substring(10, 12)), // минута
        parseInt(timestamp.substring(12, 14)) // секунда
    );
    const dateStr = date.toLocaleDateString('ru-RU', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit' 
    });
    const timeStr = date.toLocaleTimeString('ru-RU', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit'
    });
    return `${dateStr} ${timeStr}`;
}

// Парсинг списка файлов с добавлением распарсенных данных
// Возвращает массив файлов с добавленным полем parsed
// @param {Array} files - массив файлов (объекты с полем name или строки)
// @param {Function} parseSaveFilename - функция для парсинга имени файла (должна быть передана из file-manager)
// @returns {Array} - массив файлов с добавленным полем parsed и гарантированным полем name
export function parseFilesList(files, parseSaveFilename) {
    return files.map(file => {
        const filename = file.name || file;
        const parsed = parseSaveFilename(filename);
        // Гарантируем наличие поля name в результате
        return { ...(typeof file === 'object' ? file : {}), name: filename, parsed };
    });
}

// Сортировка по timestamp
// Поддерживает как файлы с полем parsed.timestamp, так и объекты с полем timestamp
// @param {Array} items - массив файлов (с parsed.timestamp) или объектов (с timestamp)
// @param {boolean} descending - true для сортировки от новых к старым (по умолчанию), false для обратного порядка
// @returns {Array} - отсортированный массив
export function sortByTimestamp(items, descending = true) {
    return items.sort((a, b) => {
        // Поддерживаем оба формата: parsed.timestamp (для файлов) и timestamp (для объектов)
        const timestampA = a.parsed?.timestamp || a.timestamp;
        const timestampB = b.parsed?.timestamp || b.timestamp;
        
        if (!timestampA || !timestampB) return 0;
        
        if (descending) {
            return timestampB.localeCompare(timestampA);
        } else {
            return timestampA.localeCompare(timestampB);
        }
    });
}

