// API клиент для плагина kv-cache-manager
// Содержит только описания эндпоинтов и базовую обработку ошибок

import HttpClient from './http-client.js';
import { FILE_PLUGIN_API_TIMEOUTS } from '../settings.js';

/**
 * API клиент для работы с плагином kv-cache-manager
 */
class FilePluginApi {
    constructor() {
        this.httpClient = new HttpClient();
        this._csrfTokenCache = null;
    }

    /**
     * Получение CSRF токена (кэшируется)
     * @param {Object} options - Опции запроса
     * @param {number} options.timeout - Таймаут в миллисекундах (по умолчанию 5000)
     * @returns {Promise<string|null>} - CSRF токен или null при ошибке
     */
    async getCsrfToken(options = {}) {
        if (this._csrfTokenCache) {
            return this._csrfTokenCache;
        }

        try {
            const url = '/csrf-token';
            const requestOptions = {
                timeout: FILE_PLUGIN_API_TIMEOUTS.CSRF_TOKEN,
                ...options
            };
            
            const response = await this.httpClient.get(url, requestOptions);

            if (response && response.token) {
                this._csrfTokenCache = response.token;
                return this._csrfTokenCache;
            }
        } catch (e) {
            // Тихая обработка ошибки - возвращаем null
        }

        return null;
    }

    /**
     * Получение списка файлов
     * @param {Object} options - Опции запроса
     * @param {number} options.timeout - Таймаут в миллисекундах (по умолчанию 10000)
     * @returns {Promise<Object|null>} - Список файлов или null при ошибке
     * @throws {Error} - При ошибке запроса
     */
    async getFilesList(options = {}) {
        const url = '/api/plugins/kv-cache-manager/files';
        const requestOptions = {
            timeout: FILE_PLUGIN_API_TIMEOUTS.GET_FILES,
            ...options
        };
        
        return await this.httpClient.get(url, requestOptions);
    }

    /**
     * Удаление файла
     * @param {string} filename - Имя файла для удаления
     * @param {Object} options - Опции запроса
     * @param {number} options.timeout - Таймаут в миллисекундах (по умолчанию 10000)
     * @returns {Promise<void>}
     * @throws {Error} - При ошибке запроса
     */
    async deleteFile(filename, options = {}) {
        const url = `/api/plugins/kv-cache-manager/files/${filename}`;
        const requestOptions = {
            timeout: FILE_PLUGIN_API_TIMEOUTS.DELETE_FILE,
            ...options
        };
        
        // Получаем CSRF токен и добавляем в заголовки
        const csrfToken = await this.getCsrfToken();
        const headers = { ...requestOptions.headers };
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }

        return await this.httpClient.delete(url, {
            ...requestOptions,
            headers,
            credentials: 'same-origin'
        });
    }
}

export default FilePluginApi;

