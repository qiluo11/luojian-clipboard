import { useEffect, useId, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { webAiDelayFromSeconds, webAiSiteKey } from '../../../../shared/lib/webAiDelay';

type Translate = (key: string) => string;
type SiteDelays = Record<string, number>;

export function WebAiDelayInput({ value, disabled = false, label, t, onCommit }: {
    value: number;
    disabled?: boolean;
    label: string;
    t: Translate;
    onCommit: (ms: number) => Promise<unknown>;
}) {
    const [draft, setDraft] = useState(String(value / 1000));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const errorId = useId();
    useEffect(() => { setDraft(String(value / 1000)); setError(''); }, [value]);

    const commit = async () => {
        if (disabled || busy) return;
        const next = webAiDelayFromSeconds(draft);
        if (next === null) { setError(t('web_ai_delay_range')); return; }
        setError('');
        if (next === value) { setDraft(String(value / 1000)); return; }
        setBusy(true);
        try {
            await onCommit(next);
            setDraft(String(next / 1000));
        } catch (err) {
            console.error(err);
            setError(t('web_ai_delay_save_failed'));
        } finally { setBusy(false); }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <input
                    className="search-input"
                    style={{ width: '82px', minWidth: 0, padding: '6px' }}
                    type="number" min="0" max="60" step="0.1"
                    value={draft} disabled={disabled || busy}
                    aria-label={label} aria-invalid={!!error}
                    aria-describedby={error ? errorId : undefined}
                    onFocus={() => invoke('focus_clipboard_window').catch(console.error)}
                    onChange={event => { setDraft(event.target.value); setError(''); }}
                    onBlur={() => { void commit(); }}
                    onKeyDown={event => {
                        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                    }}
                />
                <span style={{ fontSize: '12px' }}>{t('web_ai_delay_seconds')}</span>
            </div>
            {error && <span id={errorId} role="alert" style={{ color: '#dc5252', fontSize: '11px' }}>{error}</span>}
        </div>
    );
}

export default function WebAiSiteDelaySettings({ t, defaultDelayMs, sites }: {
    t: Translate;
    defaultDelayMs: number;
    sites: Array<{ label: string; url: string }>;
}) {
    const [delays, setDelays] = useState<SiteDelays>({});
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let disposed = false;
        setLoaded(false);
        setError('');
        invoke<SiteDelays>('get_web_ai_site_delays').then(next => {
            if (!disposed) { setDelays(next); setLoaded(true); }
        }).catch(err => {
            console.error(err);
            if (!disposed) setError(t('web_ai_delay_load_failed'));
        });
        return () => { disposed = true; };
    }, [attempt, t]);

    const rows = new Map<string, { label: string; url: string }>();
    for (const site of sites) {
        const key = webAiSiteKey(site.url);
        if (key && !rows.has(key)) rows.set(key, { ...site, label: site.label || key });
    }
    // Retain access to saved overrides even after the last prompt using them is removed.
    for (const key of Object.keys(delays)) {
        if (!rows.has(key)) rows.set(key, { label: key, url: `${key.endsWith(':443') ? 'http' : 'https'}://${key}` });
    }
    const save = async (url: string, delayMs: number | null) => {
        setBusy(true);
        setError('');
        try {
            const next = await invoke<SiteDelays>('set_web_ai_site_delay', { url, delayMs });
            setDelays(next);
        } catch (err) {
            console.error(err);
            setError(t('web_ai_delay_save_failed'));
            throw err;
        } finally { setBusy(false); }
    };

    return (
        <section aria-label={t('web_ai_site_delays')} style={{ margin: '10px 0 18px' }}>
            <span className="ai-sub-label">{t('web_ai_site_delays')}</span>
            <p style={{ fontSize: '11px', lineHeight: 1.6, opacity: 0.7, margin: '6px 0 10px' }}>
                {t('web_ai_site_delay_hint')}
            </p>
            {!loaded && !error && <p role="status">{t('web_ai_delay_loading')}</p>}
            {error && <div role="alert" style={{ color: '#dc5252', fontSize: '12px', marginBottom: '8px' }}>
                {error}{' '}
                {!loaded && <button type="button" className="btn-icon" onClick={() => setAttempt(n => n + 1)}>{t('web_ai_delay_retry')}</button>}
            </div>}
            {Array.from(rows, ([key, site]) => {
                const custom = Object.prototype.hasOwnProperty.call(delays, key);
                return <div key={key} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
                    gap: '8px 16px', border: '1px solid var(--border-dark)', borderRadius: '6px',
                    padding: '10px', marginBottom: '6px'
                }}>
                    <div style={{ minWidth: 0, flex: '1 1 150px' }}>
                        <div style={{ fontSize: '13px', overflowWrap: 'anywhere' }}>{site.label}</div>
                        {site.label !== key && <div style={{ fontSize: '10px', opacity: 0.6, overflowWrap: 'anywhere' }}>{key}</div>}
                        <div style={{ fontSize: '10px', opacity: 0.65, marginTop: '3px' }}>
                            {custom ? t('web_ai_delay_custom') : t('web_ai_delay_follow_default')}
                        </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                            <input type="checkbox" checked={custom} disabled={!loaded || busy}
                                aria-label={`${site.label}: ${t('web_ai_delay_custom')}`}
                                onFocus={() => invoke('focus_clipboard_window').catch(console.error)}
                                onChange={event => { void save(site.url, event.target.checked ? defaultDelayMs : null).catch(() => {}); }} />
                            {t('web_ai_delay_custom')}
                        </label>
                        <WebAiDelayInput key={String(custom)} value={custom ? delays[key] : defaultDelayMs}
                            disabled={!loaded || !custom || busy}
                            label={site.label} t={t}
                            onCommit={ms => save(site.url, ms)} />
                    </div>
                </div>;
            })}
            <p style={{ fontSize: '11px', lineHeight: 1.6, opacity: 0.7, margin: '8px 0 0' }}>
                {t('web_ai_delay_limit_hint')}
            </p>
        </section>
    );
}
