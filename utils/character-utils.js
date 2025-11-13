// Утилиты для работы с персонажами для KV Cache Manager

import { getContext } from "../../../../extensions.js";
import { getGroupMembers, selected_group, groups } from '../../../../group-chats.js';

import { normalizeCharacterName } from './utils.js';

// Получение персонажей текущего чата с информацией о мьюте
// Работает только для групповых чатов
// @returns {Array<{name: string, normalizedName: string, characterId: string, avatar: string, isMuted: boolean}>}
export function getChatCharactersWithMutedStatus() {
    try {
        const context = getContext();
        
        if (!context) {
            console.warn('[KV Cache Manager] Не удалось получить контекст чата');
            return [];
        }
        
        // Проверяем, является ли чат групповым
        if (context.groupId === null || context.groupId === undefined) {
            // Обычный чат - возвращаем пустой массив (предзагрузка только для групповых)
            return [];
        }
        
        // Групповой чат
        const groupMembers = getGroupMembers();
        
        if (!groupMembers || groupMembers.length === 0) {
            console.warn('[KV Cache Manager] Не найдено участников группового чата');
            return [];
        }
        
        // Получаем информацию о мьюченных персонажах
        const group = groups?.find(x => x.id === selected_group);
        const disabledMembers = group?.disabled_members ?? [];
        
        // Формируем массив персонажей с информацией о мьюте
        const characters = groupMembers
            .filter(member => member && member.name && typeof member.name === 'string')
            .map(member => {
                const normalizedName = normalizeCharacterName(member.name);
                // Проверяем, мьючен ли персонаж (проверяем наличие avatar в disabledMembers)
                const isMuted = disabledMembers.includes(member.avatar);
                
                // Получаем characterId из контекста персонажей
                let characterId = null;
                if (context.characters) {
                    const characterEntry = Object.entries(context.characters).find(
                        ([id, char]) => char && char.name === member.name
                    );
                    if (characterEntry) {
                        characterId = Number(characterEntry[0]);
                    }
                }
                
                return {
                    name: member.name,
                    normalizedName: normalizedName,
                    characterId: characterId,
                    avatar: member.avatar,
                    isMuted: isMuted
                };
            });
        
        return characters;
    } catch (e) {
        console.error('[KV Cache Manager] Ошибка при получении персонажей с информацией о мьюте:', e);
        return [];
    }
}

// Получение нормализованного имени персонажа из контекста генерации
// @returns {string|null} - нормализованное имя персонажа или null
export function getNormalizedCharacterNameFromContext() {
    try {
        const context = getContext();
        
        if (!context || !context.characterId) {
            return null;
        }
        
        const character = context.characters[context.characterId];
        if (!character || !character.name) {
            return null;
        }
        
        return normalizeCharacterName(character.name);
    } catch (e) {
        console.error('[KV Cache Manager] Ошибка при получении имени персонажа из контекста:', e);
        return null;
    }
}

// Получение нормализованного имени персонажа из данных события
// @param {any} data - данные события
// @returns {string|null} - нормализованное имя персонажа или null
export function getNormalizedCharacterNameFromData(data) {
    if (!data) {
        return null;
    }
    
    const characterName = data?.char || data?.name || null;
    if (!characterName || typeof characterName !== 'string') {
        return null;
    }
    
    return normalizeCharacterName(characterName);
}

