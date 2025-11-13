// HTTP-клиент для KV Cache Manager
// Базовый клиент для выполнения HTTP-запросов с таймаутами и обработкой ошибок

/**
 * HTTP-клиент для выполнения запросов
 */
class HttpClient {
    /**
     * Выполнение HTTP-запроса с таймаутом и обработкой ошибок
     * @param {string} url - Полный URL для запроса
     * @param {Object} options - Опции запроса
     * @param {string} options.method - HTTP метод (GET, POST, DELETE и т.д.)
     * @param {number} options.timeout - Таймаут в миллисекундах (по умолчанию 10000)
     * @param {Object} options.headers - Заголовки запроса
     * @param {Object|string} options.body - Тело запроса (будет сериализовано в JSON, если объект)
     * @param {string} options.credentials - Credentials для запроса (same-origin, include и т.д.)
     * @returns {Promise<Object|string|null>} - Распарсенный JSON ответ, текст или null
     * @throws {Error} - При ошибке запроса или таймауте
     */
    async request(url, options = {}) {
        const {
            method = 'GET',
            timeout = 10000,
            headers = {},
            body = null,
            credentials = undefined
        } = options;

        // Устанавливаем Content-Type для JSON, если передается объект
        if (body && typeof body === 'object' && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }

        let timeoutId = null;
        try {
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), timeout);

            const fetchOptions = {
                method,
                headers,
                signal: controller.signal
            };

            if (body !== null) {
                fetchOptions.body = typeof body === 'object' ? JSON.stringify(body) : body;
            }

            if (credentials !== undefined) {
                fetchOptions.credentials = credentials;
            }

            const response = await fetch(url, fetchOptions);
            
            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            // Пытаемся распарсить JSON, если есть контент
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }
            
            // Если есть текст, возвращаем его
            const text = await response.text();
            return text || null;
        } catch (e) {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            
            if (e.name === 'AbortError') {
                throw new Error(`Таймаут запроса (${timeout}ms)`);
            }
            
            throw e;
        }
    }

    /**
     * GET запрос
     * @param {string} url - URL для запроса
     * @param {Object} options - Опции запроса
     * @returns {Promise<Object|string|null>}
     */
    async get(url, options = {}) {
        return this.request(url, { ...options, method: 'GET' });
    }

    /**
     * POST запрос
     * @param {string} url - URL для запроса
     * @param {Object|string} body - Тело запроса
     * @param {Object} options - Опции запроса
     * @returns {Promise<Object|string|null>}
     */
    async post(url, body = null, options = {}) {
        return this.request(url, { ...options, method: 'POST', body });
    }

    /**
     * DELETE запрос
     * @param {string} url - URL для запроса
     * @param {Object} options - Опции запроса
     * @returns {Promise<Object|string|null>}
     */
    async delete(url, options = {}) {
        return this.request(url, { ...options, method: 'DELETE' });
    }
}

export default HttpClient;
