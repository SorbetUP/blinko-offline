
const normalizeEndpoint = (raw: string): string => {
    const cleaned = (raw || '').replace(/\"/g, '').trim();
    if (!cleaned) return '';
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleaned);
    const withScheme = hasScheme ? cleaned : `http://${cleaned}`;
    try {
        return new URL(withScheme).toString().replace(/\/$/, '');
    } catch {
        return '';
    }
};

const resolveEndpoint = (path: string, base: string): string => {
    try {
        return new URL(path, base).toString();
    } catch {
        return new URL(path, window.location.origin).toString();
    }
};

export function getBlinkoEndpoint(path: string = ''): string {
    try {
        const isTauri = !!(window as any).__TAURI__;
        if (isTauri) {
            return resolveEndpoint(path, window.location.origin);
        }

        const blinkoEndpoint = window.localStorage.getItem('blinkoEndpoint');
        if (blinkoEndpoint) {
            const normalized = normalizeEndpoint(blinkoEndpoint);
            if (normalized) return resolveEndpoint(path, normalized);
        }

        return resolveEndpoint(path, window.location.origin);
    } catch {
        return resolveEndpoint(path, window.location.origin);
    }
}

export function getRemoteEndpoint(path: string = ''): string {
    try {
        const blinkoEndpoint = window.localStorage.getItem('blinkoEndpoint');
        if (blinkoEndpoint) {
            const normalized = normalizeEndpoint(blinkoEndpoint);
            if (normalized) return resolveEndpoint(path, normalized);
        }
        return resolveEndpoint(path, window.location.origin);
    } catch {
        return resolveEndpoint(path, window.location.origin);
    }
}

export function isTauriAndEndpointUndefined(): boolean {
    const isTauri = !!(window as any).__TAURI__;
    const blinkoEndpoint = window.localStorage.getItem('blinkoEndpoint')
    return isTauri && !blinkoEndpoint;
}

export function saveBlinkoEndpoint(endpoint: string): void {
    const normalized = normalizeEndpoint(endpoint);
    if (normalized) {
        window.localStorage.setItem('blinkoEndpoint', normalized);
        return;
    }
    window.localStorage.removeItem('blinkoEndpoint');
}

export function getSavedEndpoint(): string {
    const raw = window.localStorage.getItem('blinkoEndpoint') || '';
    return normalizeEndpoint(raw) || '';
}
