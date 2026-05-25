//! Module graph — builds and queries a parent-child tree from
//! scanned [`ModuleDescriptor`]s.

use std::collections::HashMap;

use super::types::{ModuleDescriptor, ModuleGraphNode};

/// The constructed module graph.
#[derive(Debug, Default)]
pub struct ModuleGraph {
    nodes: HashMap<String, ModuleGraphNode>,
    root: Option<String>,
}

impl ModuleGraph {
    /// Build a module graph from scanned descriptors.
    pub fn build(
        &mut self,
        descriptors: Vec<ModuleDescriptor>,
        _project_root: &std::path::Path,
    ) -> Result<(), crate::util::AppError> {
        self.nodes.clear();

        for desc in &descriptors {
            let node = ModuleGraphNode {
                name: desc.name.clone(),
                absolute_path: desc.root_path.clone(),
                relative_path: desc.relative_path.clone(),
                parent: None,
                children: Vec::new(),
                definition: desc.definition.clone(),
            };
            self.nodes.insert(desc.name.clone(), node);
        }

        // Find root — the descriptor with relative_path == "."
        if let Some(root_desc) = descriptors.iter().find(|d| d.relative_path == ".") {
            self.root = Some(root_desc.name.clone());
        } else if !descriptors.is_empty() {
            self.root = Some(descriptors[0].name.clone());
        }

        Ok(())
    }

    /// Number of nodes in the graph.
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    /// Whether the graph is empty.
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// The root node name, if any.
    pub fn root(&self) -> Option<&str> {
        self.root.as_deref()
    }

    /// Look up a node by name.
    pub fn get(&self, name: &str) -> Option<&ModuleGraphNode> {
        self.nodes.get(name)
    }

    /// Reference to all nodes.
    pub fn nodes(&self) -> &HashMap<String, ModuleGraphNode> {
        &self.nodes
    }
}
