//! Per-tag auto-classification rules ("自动分类规则").
//!
//! Each saved tag may carry a list of user-defined regex patterns (stored as a
//! JSON array string in `saved_tags.auto_rules`, see Migration 14). During the
//! clipboard capture pipeline, content matching any pattern of a tag causes
//! that tag to be attached to the NEW entry only.
//!
//! Semantics:
//! - Matching is case-insensitive (`(?i)` is forced on every pattern).
//! - A pattern that fails to compile is skipped with a log line; it never
//!   blocks capture or other rules.
//! - Rule matching only TAGS entries. It never triggers masking/desensitization
//!   (that remains exclusive to the `sensitive` tag / privacy protection
//!   settings; see `contains_sensitive_info`).
//! - Content longer than [`MAX_CONTENT_BYTES`] skips matching entirely to keep
//!   the capture hot path responsive (mirrors the oversized-text guard in
//!   `contains_sensitive_info`).

use regex::RegexBuilder;
use std::collections::HashMap;

/// Max regex patterns stored per single tag.
pub const MAX_RULES_PER_TAG: usize = 50;
/// Max regex patterns across all tags combined.
pub const MAX_TOTAL_RULES: usize = 500;
/// Content longer than this (bytes) is skipped for rule matching.
pub const MAX_CONTENT_BYTES: usize = 10 * 1024;

/// Returns the tag names whose rules match `content` (deduplicated, order
/// follows HashMap iteration). Empty when oversized or no rules configured.
pub fn matched_tags(rules: &HashMap<String, Vec<String>>, content: &str) -> Vec<String> {
    let mut matched = Vec::new();
    if content.is_empty() || content.len() > MAX_CONTENT_BYTES {
        return matched;
    }

    for (tag, patterns) in rules {
        let tag = tag.trim();
        if tag.is_empty() {
            continue;
        }
        for pattern in patterns.iter().take(MAX_RULES_PER_TAG) {
            match RegexBuilder::new(pattern)
                .case_insensitive(true)
                .build()
            {
                Ok(re) => {
                    if re.is_match(content) {
                        matched.push(tag.to_string());
                        break; // one hit is enough for this tag
                    }
                }
                Err(err) => {
                    println!(
                        "auto_tag: skipping invalid regex {:?} for tag {:?}: {}",
                        pattern, tag, err
                    );
                }
            }
        }
    }
    matched
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules(pairs: &[(&str, &[&str])]) -> HashMap<String, Vec<String>> {
        pairs
            .iter()
            .map(|(tag, list)| {
                (
                    tag.to_string(),
                    list.iter().map(|p| p.to_string()).collect::<Vec<String>>(),
                )
            })
            .collect()
    }

    #[test]
    fn matches_case_insensitive_regex() {
        let map = rules(&[("工作", &["TODO.*周報", "周报"])]);
        let hits = matched_tags(&map, "周一 todo 整理 周报");
        assert_eq!(hits, vec!["工作".to_string()]);
    }

    #[test]
    fn keyword_without_regex_syntax_still_matches_as_pattern() {
        let map = rules(&[("账号", &[r"(?i)password\s*[:=]"])]);
        assert!(matched_tags(&map, "PASSWORD: abc123").contains(&"账号".to_string()));
    }

    #[test]
    fn multiple_rules_tag_matches_only_once() {
        let map = rules(&[("t", &["foo", "bar", "baz"])]);
        let hits = matched_tags(&map, "foo and bar");
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn invalid_regex_is_skipped_without_failing_others() {
        let map = rules(&[("bad", &["[unclosed"]), ("good", &["ok"])]);
        let hits = matched_tags(&map, "all ok here");
        assert_eq!(hits, vec!["good".to_string()]);
    }

    #[test]
    fn skips_oversized_content() {
        let map = rules(&[("t", &["needle"])]);
        let mut big = "x".repeat(MAX_CONTENT_BYTES + 1);
        big.push_str("needle");
        assert!(matched_tags(&map, &big).is_empty());

        let small = format!("{}needle", "x".repeat(100));
        assert!(!matched_tags(&map, &small).is_empty());
    }

    #[test]
    fn empty_inputs_produce_no_tags() {
        let map = rules(&[("", &["a"]), ("t", &[])]);
        assert!(matched_tags(&map, "a").is_empty());
        assert!(matched_tags(&rules(&[("t", &["a"])]), "").is_empty());
    }
}
