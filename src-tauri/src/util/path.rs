//! Path normalization utilities.
//!
//! Mirrors the logic in the original TypeScript `PathUtils.ts`.

/// Normalize a path that may contain Windows-style backslashes or absolute
/// Windows drive letters (e.g. `E:\foo\bar`) to a canonical form.
///
/// On non-Windows platforms, `E:\foo\bar` becomes `/mnt/e/foo/bar`.
pub fn normalize_path(raw: &str) -> String {
    let normalized = raw.replace('\\', "/");

    #[cfg(not(target_os = "windows"))]
    {
        // If the path looks like a Windows absolute path (`X:/...`),
        // convert it to a WSL-style mount point.
        if let Some(rest) = normalized.strip_prefix(|c: char| c.is_ascii_alphabetic()) {
            if let Some(rest) = rest.strip_prefix(":/") {
                let drive = normalized.chars().next().unwrap().to_ascii_lowercase();
                return format!("/mnt/{}/{}", drive, rest);
            }
        }
    }

    normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_backslashes() {
        assert_eq!(normalize_path("foo\\bar\\baz"), "foo/bar/baz");
    }

    #[test]
    fn test_normalize_unix_path_unchanged() {
        assert_eq!(normalize_path("foo/bar/baz"), "foo/bar/baz");
    }
}
