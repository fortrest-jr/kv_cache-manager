// Утилиты для работы со скрытыми сообщениями в чате

import { getContext } from "../../../extensions.js";
import { eventSource, event_types, chat, saveChatConditional, addOneMessage, updateMessageBlock } from "../../../../script.js";


// Создание невидимого сообщения для отслеживания прогресса
// @param {string} text - Текст сообщения
// @param {string} name - Имя отправителя (по умолчанию 'System')
// @returns {Promise<number>} - ID созданного сообщения
export async function createHiddenMessage(text, name = 'System') {
    console.debug('[KV Cache Manager] createHiddenMessage: начало создания сообщения', { name, textLength: text.length });
    
    const context = getContext();
    const IGNORE_SYMBOL = context.symbols.ignore;
    
    const message = {
        name: name,
        is_user: false,
        is_system: true,
        send_date: context.humanizedDateTime(),
        mes: text,
        extra: {
            // [IGNORE_SYMBOL]: true,
            gen_id: Date.now(),
            // api: 'manual',
            // model: 'hidden message',
            isSmallSys: true,
        },
    };
    
    chat.push(message);
    addOneMessage(message);
    await saveChatConditional();
    
    const messageId = chat.length - 1;
    console.debug('[KV Cache Manager] createHiddenMessage: сообщение добавлено в чат', { messageId, chatLength: chat.length });
    
    // Эмитим события
    await eventSource.emit(event_types.MESSAGE_SENT, messageId);
    await eventSource.emit(event_types.USER_MESSAGE_RENDERED, messageId);
    
    console.debug('[KV Cache Manager] createHiddenMessage: события отправлены, возвращаем ID', { messageId });
    
    return messageId; // Возвращаем ID сообщения
}

// Обновление скрытого сообщения
// @param {number} messageId - ID сообщения для обновления
// @param {string} newText - Новый текст сообщения
export async function editMessageUsingUpdate(messageId, newText) {
    console.debug('[KV Cache Manager] editMessageUsingUpdate: начало обновления', { messageId, chatLength: chat.length, newTextLength: newText.length });
    
    if (messageId < 0 || messageId >= chat.length) {
        console.error('[KV Cache Manager] Invalid message ID:', messageId, 'chat.length:', chat.length);
        return;
    }
    
    const message = chat[messageId];
    
    if (!message) {
        console.error('[KV Cache Manager] Сообщение не найдено по ID:', messageId);
        return;
    }
    
    const oldText = message.mes;
    message.mes = newText;
    
    console.debug('[KV Cache Manager] editMessageUsingUpdate: обновление текста сообщения', { 
        messageId, 
        oldTextLength: oldText?.length, 
        newTextLength: newText.length,
        messageExists: !!message
    });
    
    updateMessageBlock(messageId, message, { rerenderMessage: true });
    console.debug('[KV Cache Manager] editMessageUsingUpdate: updateMessageBlock вызван');
    
    await saveChatConditional();
    console.debug('[KV Cache Manager] editMessageUsingUpdate: сообщение обновлено и сохранено', { messageId });
}

