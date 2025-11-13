// Утилиты для работы со скрытыми сообщениями в чате

import { getContext } from "../../../../extensions.js";
import { eventSource, event_types, chat, saveChatConditional, addOneMessage, updateMessageBlock } from "../../../../../script.js";


// Создание невидимого сообщения для отслеживания прогресса
// @param {string} text - Текст сообщения
// @param {string} name - Имя отправителя (по умолчанию 'System')
// @returns {Promise<number>} - ID созданного сообщения
export async function createHiddenMessage(text, isSmallSys = true, name = 'KV Cache Manager') {
    const context = getContext();
    const IGNORE_SYMBOL = context.symbols.ignore;
    
    const message = {
        name: name,
        is_user: false,
        is_system: true,
        send_date: context.humanizedDateTime(),
        mes: text,
        extra: {
            gen_id: Date.now(),
            isSmallSys: isSmallSys,
        },
    };
    
    chat.push(message);
    addOneMessage(message);
    await saveChatConditional();
    
    const messageId = chat.length - 1;
    
    // Эмитим события
    await eventSource.emit(event_types.MESSAGE_SENT, messageId);
    await eventSource.emit(event_types.USER_MESSAGE_RENDERED, messageId);
    
    // Устанавливаем левое выравнивание для текста сообщения
    setTimeout(() => {
        const messageElement = $('#chat').find(`[mesid="${messageId}"]`);
        if (messageElement.length > 0) {
            messageElement.find('.mes_text').css('text-align', 'left');
        }
    }, 100);
    
    return messageId;
}

// Обновление скрытого сообщения
// @param {number} messageId - ID сообщения для обновления
// @param {string} newText - Новый текст сообщения
export async function editMessageUsingUpdate(messageId, newText) {
    if (messageId < 0 || messageId >= chat.length) {
        console.error('[KV Cache Manager] Invalid message ID:', messageId, 'chat.length:', chat.length);
        return;
    }
    
    const message = chat[messageId];
    
    if (!message) {
        console.error('[KV Cache Manager] Сообщение не найдено по ID:', messageId);
        return;
    }
    
    message.mes = newText;
    updateMessageBlock(messageId, message, { rerenderMessage: true });
    await saveChatConditional();
}

