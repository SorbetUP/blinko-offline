
let cachedEndpoint: string | null = null;
let localHttpUnavailable = false;

export function isLocalEndpoint(endpoint: string): boolean {
    return endpoint.startsWith('http://127.0.0.1') || endpoint.startsWith('http://localhost');
}

export function getBlinkoEndpoint(path: string = ''): string {
    try {
        const isTauri = !!(window as any).__TAURI__;
        const stored = window.localStorage.getItem('blinkoEndpoint');
        const base = cachedEndpoint || (isTauri && stored ? stored.replace(/\"/g, '') : window.location.origin);
        return new URL(path, base).toString();
    } catch (error) {
        console.error(error);
        return new URL(path, window.location.origin).toString();
    }
}

export function isTauriAndEndpointUndefined(): boolean {
    const isTauri = !!(window as any).__TAURI__;
    const blinkoEndpoint = window.localStorage.getItem('blinkoEndpoint')
    return isTauri && !blinkoEndpoint;
}

export function saveBlinkoEndpoint(endpoint: string): void {
    if (endpoint) {
        window.localStorage.setItem('blinkoEndpoint', endpoint);
        cachedEndpoint = endpoint;
    }
}

export function getSavedEndpoint(): string {
    return window.localStorage.getItem('blinkoEndpoint') || '';
}

export function isLocalMode(): boolean {
    const stored = getSavedEndpoint();
    const base = cachedEndpoint || stored || window.location.origin;
    return isLocalEndpoint(base);
}

export function setLocalHttpUnavailable(value: boolean): void {
    localHttpUnavailable = value;
}

export function isLocalHttpUnavailable(): boolean {
    return localHttpUnavailable;
}

export async function resolveBaseUrl(): Promise<string> {
    try {
        if (cachedEndpoint) {
            return cachedEndpoint;
        }
        const stored = getSavedEndpoint();
        if (stored) {
            cachedEndpoint = stored.replace(/\"/g, '');
            return cachedEndpoint;
        }
        const isTauri = !!(window as any).__TAURI__;
        if (isTauri) {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const baseUrl = await invoke<string | null>('get_local_api_base_url');
                if (baseUrl) {
                    saveBlinkoEndpoint(baseUrl);
                    return baseUrl;
                }
            } catch (error) {
                console.error('Failed to resolve local api base url:', error);
            }
        }
        cachedEndpoint = window.location.origin;
        return cachedEndpoint;
    } catch (error) {
        console.error(error);
        return window.location.origin;
    }
}
