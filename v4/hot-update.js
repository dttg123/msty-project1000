function plugin() { return window?.Capacitor?.Plugins?.HotUpdate || null; }
export function isHotUpdateAvailable() { return !!plugin(); }
export async function hotUpdateStatus() { const target = plugin(); if (!target)
    return { available: false, currentVersion: '', latestVersion: '', updateAvailable: false, nativeUpdateRequired: false }; return target.status(); }
export async function installHotUpdate() { const target = plugin(); if (!target)
    throw new Error('Android 앱에서만 업데이트할 수 있습니다.'); return target.install(); }
export async function confirmHotUpdateReady() { const target = plugin(); if (target)
    await target.confirmReady(); }
