// API клиент для llama.cpp сервера
// Содержит только описания эндпоинтов и базовую обработку ошибок

import { textgen_types, textgenerationwebui_settings } from '../../../../textgen-settings.js';

import HttpClient from './http-client.js';
import { LLAMA_API_TIMEOUTS } from '../settings.js';

/**
 * API клиент для работы с llama.cpp сервером
 */
class LlamaApi {
    constructor() {
        this.httpClient = new HttpClient();
    }

    /**
     * Получение базового URL сервера
     * @returns {string} - Базовый URL
     */
    _getBaseUrl() {
        const provided_url = textgenerationwebui_settings.server_urls[textgen_types.LLAMACPP];
        return provided_url;
    }

    /**
     * Формирует полный URL для запроса
     * @param {string} path - Путь эндпоинта
     * @returns {string} - Полный URL
     */
    _buildUrl(path) {
        const baseUrl = this._getBaseUrl();
        const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        return `${base}${cleanPath}`;
    }

    /**
     * Получение информации о всех слотах
     * @param {Object} options - Опции запроса
     * @param {number} options.timeout - Таймаут в миллисекундах (по умолчанию 10000)
     * @returns {Promise<Array|Object|null>} - Информация о слотах или null при ошибке
     * @throws {Error} - При ошибке запроса
     */
    async getSlots(options = {}) {
        const url = this._buildUrl('slots');
        const requestOptions = {
            timeout: LLAMA_API_TIMEOUTS.GET_SLOTS,
            ...options
        };
        
        return await this.httpClient.get(url, requestOptions);
    }

    /**
     * Сохранение кеша для слота
     * @param {number} slotId - Индекс слота
     * @param {string} filename - Имя файла для сохранения
     * @param {Object} options - Опции запроса
     * @param {number} options.timeout - Таймаут в миллисекундах (по умолчанию 300000)
     * @returns {Promise<void>}
     * @throws {Error} - При ошибке запроса
     */
    async saveSlotCache(slotId, filename, options = {}) {
        const url = this._buildUrl(`slots/${slotId}?action=save`);
        const requestOptions = {
            timeout: LLAMA_API_TIMEOUTS.SAVE_CACHE,
            ...options
        };
        
        return await this.httpClient.post(url, { filename }, requestOptions);
    }

    /**
     * Загрузка кеша для слота
     * @param {number} slotId - Индекс слота
     * @param {string} filename - Имя файла для загрузки
     * @param {Object} options - Опции запроса
     * @param {number} options.timeout - Таймаут в миллисекундах (по умолчанию 300000)
     * @returns {Promise<void>}
     * @throws {Error} - При ошибке запроса
     */
    async loadSlotCache(slotId, filename, options = {}) {
        const url = this._buildUrl(`slots/${slotId}?action=restore`);
        const requestOptions = {
            timeout: LLAMA_API_TIMEOUTS.LOAD_CACHE,
            ...options
        };
        
        return await this.httpClient.post(url, { filename }, requestOptions);
    }

    /**
     * Очистка кеша для слота
     * @param {number} slotId - Индекс слота
     * @param {Object} options - Опции запроса
     * @param {number} options.timeout - Таймаут в миллисекундах (по умолчанию 30000)
     * @returns {Promise<void>}
     * @throws {Error} - При ошибке запроса
     */
    async clearSlotCache(slotId, options = {}) {
        const url = this._buildUrl(`slots/${slotId}?action=erase`);
        const requestOptions = {
            timeout: LLAMA_API_TIMEOUTS.CLEAR_CACHE,
            ...options
        };
        
        return await this.httpClient.post(url, null, requestOptions);
    }
}

export default LlamaApi;

