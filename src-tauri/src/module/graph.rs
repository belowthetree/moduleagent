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
            // Pick the module with the shallowest path as root
            let root_idx = descriptors.iter()
                .enumerate()
                .min_by_key(|(_, d)| d.relative_path.split('/').count())
                .map(|(i, _)| i)
                .unwrap_or(0);
            self.root = Some(descriptors[root_idx].name.clone());
        }

        // Build parent-child relationships based on relative_path hierarchy
        let mut children: HashMap<String, Vec<String>> = HashMap::new();
        for desc in &descriptors {
            let path = desc.relative_path.replace('\\', "/");
            if let Some(pos) = path.rfind('/') {
                let parent_path = &path[..pos];
                // Find the node whose relative_path matches the parent directory
                for parent_desc in &descriptors {
                    if parent_desc.relative_path == parent_path {
                        children.entry(parent_desc.name.clone()).or_default().push(desc.name.clone());
                        if let Some(node) = self.nodes.get_mut(&desc.name) {
                            node.parent = Some(parent_desc.name.clone());
                        }
                        break;
                    }
                }
            }
        }
        for (parent_name, child_names) in children {
            if let Some(node) = self.nodes.get_mut(&parent_name) {
                node.children = child_names;
            }
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
