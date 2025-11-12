// Утилиты для работы со скрытыми сообщениями в чате

import { eventSource, event_types, chat, saveChatConditional, addOneMessage, getMessageTimeStamp, updateMessageBlock } from "../../../../script.js";
import { IGNORE_SYMBOL } from '../../../constants.js';


// Создание невидимого сообщения для отслеживания прогресса
// @param {string} text - Текст сообщения
// @param {string} name - Имя отправителя (по умолчанию 'System')
// @returns {Promise<number>} - ID созданного сообщения
export async function createHiddenMessage(text, name = 'System') {
    const message = {
        name: name,
        is_user: false,
        is_system: false,
        send_date: getMessageTimeStamp ? getMessageTimeStamp() : new Date().toISOString(),
        mes: text,
        extra: {
            [IGNORE_SYMBOL]: true,
            gen_id: Date.now(),
            api: 'manual',
            model: 'hidden message',
        },
    };
    
    chat.push(message);
    addOneMessage(message);
    await saveChatConditional();
    
    // Эмитим события
    await eventSource.emit(event_types.MESSAGE_SENT, chat.length - 1);
    await eventSource.emit(event_types.USER_MESSAGE_RENDERED, chat.length - 1);
    
    return chat.length - 1; // Возвращаем ID сообщения
}

// Обновление скрытого сообщения
// @param {number} messageId - ID сообщения для обновления
// @param {string} newText - Новый текст сообщения
export async function editMessageUsingUpdate(messageId, newText) {
    if (messageId < 0 || messageId >= chat.length) {
        console.error('[KV Cache Manager] Invalid message ID:', messageId);
        return;
    }
    
    const message = chat[messageId];
    
    message.mes = newText;
    updateMessageBlock(messageId, message, { rerenderMessage: true });   
    await saveChatConditional();
}

