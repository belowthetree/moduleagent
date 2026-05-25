//! Role agents — isolated workspaces and role-specific agent orchestration.
//! Reuses the `agent` subsystem with role-scoped prompts and workspaces.

pub mod manager;
pub mod workspace;
