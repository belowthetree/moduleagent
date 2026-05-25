//! Module graph and scanning — walks project directories for `module.md`
//! files, parses their frontmatter, and builds a parent-child tree.

pub mod graph;
pub mod parser;
pub mod scanner;
pub mod types;
