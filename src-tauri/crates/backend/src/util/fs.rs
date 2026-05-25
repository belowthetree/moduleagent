//! Filesystem helpers.

use std::path::Path;
use tokio::fs;

/// Atomically write `content` to `dest` by writing to a `.tmp` sibling
/// first and then renaming.
pub async fn atomic_write(dest: &Path, content: &[u8]) -> std::io::Result<()> {
    let tmp = dest.with_extension("tmp");
    fs::write(&tmp, content).await?;
    fs::rename(&tmp, dest).await?;
    Ok(())
}

/// Ensure a directory exists (create if missing, including parents).
pub async fn ensure_dir(dir: &Path) -> std::io::Result<()> {
    if !dir.exists() {
        fs::create_dir_all(dir).await?;
    }
    Ok(())
}
