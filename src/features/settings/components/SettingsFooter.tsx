import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

// 分发时必须指向公开可访问的完整源码
const SOURCE_URL = "https://github.com/qiluo11/luojian-clipboard";
const UPSTREAM_URL = "https://github.com/jimuzhe/tiez-clipboard";

interface SettingsFooterProps {
    t: (key: string) => string;
    onResetSettings: () => void;
}

const SettingsFooter = ({ t, onResetSettings }: SettingsFooterProps) => {
    // 版本号运行时从 Tauri 获取，不再硬编码 fallback
    const [appVersion, setAppVersion] = useState("");

    useEffect(() => {
        getVersion()
            .then(setAppVersion)
            .catch((err) => console.error("Failed to get version:", err));
    }, []);

    return (
        <>
            {/* Footer Actions */}
            <div style={{
                marginTop: '16px',
                display: 'flex',
                justifyContent: 'center',
                gap: '12px',
                flexWrap: 'wrap'
            }}>
                {/* Reset Card */}
                <div
                    className="settings-group"
                    style={{
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        margin: 0,
                        width: 'auto',
                        padding: '10px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '0'
                    }}
                    onClick={() => onResetSettings()}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <RotateCcw size={16} />
                        <span style={{ fontSize: '13px', fontWeight: 600 }}>{t('reset_defaults')}</span>
                    </div>
                </div>
            </div>

            {/* Version Info */}
            <div style={{
                marginTop: '16px',
                marginBottom: '32px',
                textAlign: 'center',
                opacity: 1
            }}>
                <div style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    letterSpacing: '0.5px',
                    marginBottom: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                }}>
                    <span>{t('app_name')}{appVersion ? ` v${appVersion}` : ""}</span>
                </div>
                <div style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    fontWeight: 500,
                    marginBottom: '4px'
                }}>
                    {t('slogan')}
                </div>
                {/* GPL-3.0 第 5(d) 条要求的法律声明：原作者版权、修改说明、无担保、许可证与源码地址 */}
                <div className="settings-legal-notice" style={{
                    fontSize: '10px',
                    lineHeight: 1.6,
                    color: 'var(--text-secondary)',
                    opacity: 0.8,
                    marginTop: '8px',
                    padding: '0 12px',
                    userSelect: 'text'
                }}>
                    <div>{t('about_based_on')}</div>
                    <div>{t('about_license')}</div>
                    <div>{t('about_source')}: {SOURCE_URL}</div>
                    <div>{t('about_upstream')}: {UPSTREAM_URL}</div>
                </div>
            </div>
        </>
    );
};

export default SettingsFooter;
