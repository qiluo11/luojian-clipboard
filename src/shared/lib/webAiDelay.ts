export const MAX_WEB_AI_DELAY_MS = 60_000;

/** Keep in sync with web_ai_site_key in web_ai_delay_cmd.rs. */
export function webAiSiteKey(value: string): string | null {
    try {
        const url = new URL(value.trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        const host = url.hostname.replace(/\.+$/, '').replace(/^www\./, '');
        return host ? host + (url.port ? `:${url.port}` : '') : null;
    } catch {
        return null;
    }
}

/** Empty/incomplete drafts are not zero. Only commit valid seconds on blur. */
export function webAiDelayFromSeconds(draft: string): number | null {
    if (!draft.trim()) return null;
    const seconds = Number(draft);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_WEB_AI_DELAY_MS / 1000) return null;
    return Math.round(seconds * 1000);
}
