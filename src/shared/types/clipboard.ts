export interface ClipboardEntry {
  id: number;
  content_type: string;
  content: string;
  html_content?: string;
  source_app: string;
  source_app_path?: string;
  timestamp: number;
  preview: string;
  is_pinned: boolean;
  tags: string[];
  questionCount?: number;
  use_count?: number;
  is_external?: boolean;
  pinned_order?: number;
  file_preview_exists?: boolean;
  /** Not carried by list payloads; resolved from `get_display_titles` on the frontend. */
  display_title?: string | null;
}

/** Payload of the `get_clipboard_properties` command (properties panel). */
export interface ClipboardProperties {
  id: number;
  content_type: string;
  content: string;
  html_content?: string | null;
  display_title?: string | null;
  source_app: string;
  timestamp: number;
  updated_at?: number | null;
  last_used_at?: number | null;
  use_count: number;
  is_pinned: boolean;
}
