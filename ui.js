// UI компоненты и уведомления для KV Cache Manager

// Показ toast-уведомления
export function showToast(type, message, title = 'KV Cache Manager', callbacks = {}) {
    const { getExtensionSettings } = callbacks;
    const extensionSettings = getExtensionSettings ? getExtensionSettings() : {};
    
    if (typeof toastr === 'undefined') {
        console.debug(`[KV Cache Manager] ${title}: ${message}`);
        return;
    }

    if (!extensionSettings.showNotifications) {
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
