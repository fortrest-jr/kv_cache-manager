// KV Cache Manager для SillyTavern
// Расширение для управления KV-кешем llama.cpp
// Этап 1: Загрузка UI и вывод тостов при нажатии на кнопки

// Импортируем необходимые функции
import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

// Имя расширения должно совпадать с именем папки
const extensionName = "kv-cache-manager";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];

const defaultSettings = {
    enabled: true,
    saveInterval: 5,
    autoLoadOnChatSwitch: true,
    maxFiles: 10,
    showNotifications: true,
    validateCache: true
};

// Загрузка настроек
async function loadSettings() {
    // Создаем настройки, если их нет
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }

    // Обновляем настройки в UI
    const settings = extension_settings[extensionName];
    $("#kv-cache-enabled").prop("checked", settings.enabled).trigger("input");
    $("#kv-cache-save-interval").val(settings.saveInterval).trigger("input");
    $("#kv-cache-max-files").val(settings.maxFiles).trigger("input");
    $("#kv-cache-auto-load").prop("checked", settings.autoLoadOnChatSwitch).trigger("input");
    $("#kv-cache-show-notifications").prop("checked", settings.showNotifications).trigger("input");
    $("#kv-cache-validate").prop("checked", settings.validateCache).trigger("input");
}

// Показ toast-уведомления
function showToast(type, message, title = 'KV Cache Manager') {
    if (typeof toastr === 'undefined') {
        console.log(`[KV Cache Manager] ${title}: ${message}`);
        return;
    }

    const settings = extension_settings[extensionName] || defaultSettings;
    if (!settings.showNotifications) {
        return;
    }

    switch (type) {
        case 'success':
            toastr.success(message, title);
            break;
        case 'error':
            toastr.error(message, title);
            break;
        case 'warning':
            toastr.warning(message, title);
            break;
        case 'info':
        default:
            toastr.info(message, title);
            break;
    }
}

// Обработчики для чекбоксов и полей ввода
function onEnabledChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].enabled = value;
    saveSettingsDebounced();
    showToast('success', `Автосохранение ${value ? 'включено' : 'отключено'}`);
}

function onSaveIntervalChange(event) {
    const value = parseInt($(event.target).val()) || 5;
    extension_settings[extensionName].saveInterval = value;
    saveSettingsDebounced();
    showToast('info', `Интервал сохранения установлен: ${value} сообщений`);
}

function onMaxFilesChange(event) {
    const value = parseInt($(event.target).val()) || 10;
    extension_settings[extensionName].maxFiles = value;
    saveSettingsDebounced();
    showToast('info', `Максимум файлов установлен: ${value}`);
}

function onAutoLoadChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].autoLoadOnChatSwitch = value;
    saveSettingsDebounced();
    showToast('success', `Автозагрузка ${value ? 'включена' : 'отключена'}`);
}

function onShowNotificationsChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].showNotifications = value;
    saveSettingsDebounced();
    showToast('success', `Уведомления ${value ? 'включены' : 'отключены'}`);
}

function onValidateChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].validateCache = value;
    saveSettingsDebounced();
    showToast('success', `Проверка валидности ${value ? 'включена' : 'отключена'}`);
}

// Обработчики для кнопок
function onSaveButtonClick() {
    const userName = $("#kv-cache-save-name").val();
    if (userName && userName.trim()) {
        showToast('info', `Кнопка "Сохранить с именем" нажата. Имя: ${userName}`);
    } else {
        showToast('error', 'Введите имя для сохранения');
    }
}

function onLoadButtonClick() {
    showToast('info', 'Кнопка "Загрузить кеш" нажата');
}

function onSaveNowButtonClick() {
    showToast('info', 'Кнопка "Сохранить сейчас" нажата');
}

// Функция вызывается при загрузке расширения
jQuery(async () => {
    // Загружаем HTML из файла
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);

    // Добавляем HTML в контейнер настроек
    $("#extensions_settings").append(settingsHtml);

    // Настраиваем обработчики событий
    $("#kv-cache-enabled").on("input", onEnabledChange);
    $("#kv-cache-save-interval").on("input", onSaveIntervalChange);
    $("#kv-cache-max-files").on("input", onMaxFilesChange);
    $("#kv-cache-auto-load").on("input", onAutoLoadChange);
    $("#kv-cache-show-notifications").on("input", onShowNotificationsChange);
    $("#kv-cache-validate").on("input", onValidateChange);
    
    $("#kv-cache-save-button").on("click", onSaveButtonClick);
    $("#kv-cache-load-button").on("click", onLoadButtonClick);
    $("#kv-cache-save-now-button").on("click", onSaveNowButtonClick);

    // Загружаем настройки при старте
    loadSettings();
});
