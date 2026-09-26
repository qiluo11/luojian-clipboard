import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { WebAiPrompt } from "../../types";
import WebAiSiteDelaySettings, { WebAiDelayInput } from "./WebAiSiteDelaySettings";

interface WebAiSettingsGroupProps {
    t: (key: string) => string;
    collapsed: boolean;
    onToggle: () => void;
    webAiEnabled: boolean;
    setWebAiEnabled: (val: boolean) => void;
    webAiPasteDelayMs: number;
    setWebAiPasteDelayMs: (val: number) => void;
    webAiPrompts: WebAiPrompt[];
    setWebAiPrompts: (val: WebAiPrompt[]) => void;
    saveSetting: (key: string, val: string) => void;
}

const SITE_PRESETS: Array<{ labelKey: string; url: string }> = [
    { labelKey: "web_ai_site_deepseek", url: "https://chat.deepseek.com/" },
    { labelKey: "web_ai_site_doubao", url: "https://www.doubao.com/" },
    { labelKey: "web_ai_site_kimi", url: "https://www.kimi.com/" }
];

const WebAiSettingsGroup = ({
    t,
    collapsed,
    onToggle,
    webAiEnabled,
    setWebAiEnabled,
    webAiPasteDelayMs,
    setWebAiPasteDelayMs,
    webAiPrompts,
    setWebAiPrompts,
    saveSetting
}: WebAiSettingsGroupProps) => {
    const commitPrompts = (next: WebAiPrompt[]) => {
        setWebAiPrompts(next);
        saveSetting("app.web_ai_prompts", JSON.stringify(next));
    };

    const updatePrompt = (id: number, patch: Partial<WebAiPrompt>) => {
        commitPrompts(webAiPrompts.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    };

    return (
        <div className={`settings-group ${collapsed ? 'collapsed' : ''}`}>
            <div className="group-header" onClick={onToggle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ margin: 0 }}>{t('web_ai_settings')}</h3>
                </div>
                {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </div>
            {!collapsed && (
                <div className="group-content">
                    <div className="setting-item">
                        <div className="item-label-group">
                            <span className="item-label">{t('web_ai_enabled')}</span>
                        </div>
                        <label className="switch">
                            <input
                                className="cb"
                                type="checkbox"
                                checked={webAiEnabled}
                                onChange={(e) => {
                                    const val = e.target.checked;
                                    setWebAiEnabled(val);
                                    saveSetting('app.web_ai_enabled', String(val));
                                }}
                            />
                            <div className="toggle"><div className="left" /><div className="right" /></div>
                        </label>
                    </div>

                    <div className="setting-item">
                        <div className="item-label-group">
                            <span className="item-label">{t('web_ai_paste_delay')}</span>
                        </div>
                        <WebAiDelayInput
                            value={webAiPasteDelayMs}
                            label={t('web_ai_paste_delay')}
                            t={t}
                            onCommit={async next => {
                                await invoke('save_setting', { key: 'app.web_ai_paste_delay_ms', value: String(next) });
                                setWebAiPasteDelayMs(next);
                            }}
                        />
                    </div>
                    <WebAiSiteDelaySettings
                        t={t}
                        defaultDelayMs={webAiPasteDelayMs}
                        sites={[
                            ...SITE_PRESETS.map(site => ({ label: t(site.labelKey), url: site.url })),
                            ...webAiPrompts.map(prompt => ({ label: '', url: prompt.url }))
                        ]}
                    />

                    {webAiEnabled && (
                        <>
                            <span className="ai-sub-label">{t('web_ai_prompts_title')}</span>

                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px',
                                padding: '8px',
                                marginBottom: '8px',
                                background: 'rgba(0, 0, 0, 0.02)',
                                borderRadius: '8px',
                                border: '1px solid rgba(128, 128, 128, 0.1)',
                            }}>
                                {webAiPrompts.map(prompt => (
                                    <div key={prompt.id} style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '6px',
                                        padding: '8px',
                                        border: '1px solid var(--border-dark)',
                                        borderRadius: '6px',
                                    }}>
                                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                            <input
                                                className="search-input"
                                                style={{ flex: '0 0 90px', padding: '4px 6px', fontSize: '12px' }}
                                                value={prompt.name}
                                                placeholder={t('web_ai_prompt_name')}
                                                onFocus={() => invoke("focus_clipboard_window").catch(console.error)}
                                                onChange={e => updatePrompt(prompt.id, { name: e.target.value })}
                                            />
                                            <input
                                                className="search-input"
                                                style={{ flex: 1, minWidth: 0, padding: '4px 6px', fontSize: '12px' }}
                                                value={prompt.url}
                                                placeholder="https://..."
                                                onFocus={() => invoke("focus_clipboard_window").catch(console.error)}
                                                onChange={e => updatePrompt(prompt.id, { url: e.target.value })}
                                            />
                                            <button
                                                className="btn-icon"
                                                style={{ color: '#f44336' }}
                                                title={t('web_ai_delete_prompt')}
                                                onClick={() => commitPrompts(webAiPrompts.filter(p => p.id !== prompt.id))}
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                                            {SITE_PRESETS.map(site => (
                                                <button
                                                    key={site.labelKey}
                                                    className="btn-icon"
                                                    style={{
                                                        padding: '2px 8px', fontSize: '10px', height: '20px',
                                                        textTransform: 'none',
                                                        outline: prompt.url === site.url ? '1.5px solid var(--accent-color)' : undefined
                                                    }}
                                                    onClick={() => updatePrompt(prompt.id, { url: site.url })}
                                                >
                                                    {t(site.labelKey)}
                                                </button>
                                            ))}
                                            <label
                                                style={{
                                                    marginLeft: 'auto', display: 'flex',
                                                    alignItems: 'center', gap: '4px',
                                                    fontSize: '10px', cursor: 'pointer', userSelect: 'none'
                                                }}
                                                title={t('web_ai_prompt_auto_send')}
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="cb"
                                                    checked={prompt.autoSend}
                                                    style={{ accentColor: 'var(--accent-color)', cursor: 'pointer' }}
                                                    onChange={e => updatePrompt(prompt.id, { autoSend: e.target.checked })}
                                                />
                                                {t('web_ai_prompt_auto_send')}
                                            </label>
                                        </div>
                                        <textarea
                                            className="search-input"
                                            rows={3}
                                            style={{ width: '100%', resize: 'vertical', padding: '6px', fontSize: '12px', fontFamily: 'inherit' }}
                                            value={prompt.template}
                                            placeholder={t('web_ai_prompt_template_hint')}
                                            onFocus={() => invoke("focus_clipboard_window").catch(console.error)}
                                            onChange={e => updatePrompt(prompt.id, { template: e.target.value })}
                                        />
                                    </div>
                                ))}

                                <button
                                    className="btn-icon"
                                    style={{
                                        alignSelf: 'flex-end', padding: '4px 12px', fontSize: '11px',
                                        height: '24px', gap: '4px', display: 'flex', alignItems: 'center',
                                        textTransform: 'none'
                                    }}
                                    onClick={() => commitPrompts([
                                        ...webAiPrompts,
                                        {
                                            id: Date.now(),
                                            name: t('web_ai_new_prompt_name'),
                                            url: "https://chat.deepseek.com/",
                                            template: "{content}",
                                            autoSend: false
                                        }
                                    ])}
                                >
                                    <Plus size={12} /> {t('web_ai_add_prompt')}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default WebAiSettingsGroup;
