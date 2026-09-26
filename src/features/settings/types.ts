export interface UpdateModalData {
  version: string;
  notes: string;
  downloadUrl: string;
}

export type AppCleanupPolicyAction = "ignore" | "clean";

export interface AppCleanupPolicy {
  id: string;
  enabled: boolean;
  appName: string;
  appPath: string;
  action: AppCleanupPolicyAction;
  contentTypes: string[];
  cleanupRules: string;
}

/** 网页版 AI 提示词：把选中条目内容拼进模板后经浏览器粘贴发送。 */
export interface WebAiPrompt {
  id: number;
  name: string;
  url: string;
  /** 含 {content} 占位符则替换，否则在末尾拼接内容 */
  template: string;
  autoSend: boolean;
}
