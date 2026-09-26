import { Edit2, Sparkles, Trash2 } from 'lucide-react';

interface TagSidebarActionsProps {
    tagName: string;
    t: (key: string) => string;
    onRules: () => void;
    onRename: () => void;
    onDelete: () => void;
}

/** Selected-tag actions stay in normal flow, never over the tag name. */
export default function TagSidebarActions({ tagName, t, onRules, onRename, onDelete }: TagSidebarActionsProps) {
    const protectedTag = tagName === 'sensitive' || tagName === '密码';
    return (
        <section className="tag-sidebar-actions" aria-label={t('edit_tags')}>
            <div className="tag-action-caption">
                <span>{t('edit_tags')}</span>
                <strong title={tagName}>{tagName}</strong>
            </div>
            <button type="button" className="tag-settings-button rules" onClick={onRules}>
                <Sparkles size={14} /><span>{t('auto_rules')}</span>
            </button>
            {!protectedTag && (
                <div className="tag-secondary-actions">
                    <button type="button" className="tag-settings-button" onClick={onRename}>
                        <Edit2 size={13} /><span>{t('rename')}</span>
                    </button>
                    <button type="button" className="tag-settings-button danger" onClick={onDelete}>
                        <Trash2 size={13} /><span>{t('delete')}</span>
                    </button>
                </div>
            )}
        </section>
    );
}
