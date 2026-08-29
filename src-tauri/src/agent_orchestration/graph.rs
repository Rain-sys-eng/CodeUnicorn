use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde::{Deserialize, Serialize};

use super::bridge::{DelegationContextPolicy, DelegationExecutionScope};

/// Engine-agnostic orchestration DAG consumed by the Agent Bridge scheduler.
///
/// This model owns only dependency semantics. It deliberately does not spawn engines, create
/// sessions, or mutate workspaces; execution must go through `AgentBridgeService`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGraphPlan {
    pub id: String,
    pub nodes: Vec<AgentGraphNode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGraphNode {
    pub id: String,
    pub target_engine_id: String,
    pub task: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub file_refs: Vec<String>,
    #[serde(default)]
    pub context_policy: DelegationContextPolicy,
    #[serde(default)]
    pub execution_scope: DelegationExecutionScope,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedAgentGraph {
    pub(crate) nodes: BTreeMap<String, AgentGraphNode>,
    pub(crate) dependents: BTreeMap<String, Vec<String>>,
    pub(crate) indegree: BTreeMap<String, usize>,
    pub(crate) topological_order: Vec<String>,
}

impl AgentGraphPlan {
    pub(crate) fn validate(&self) -> Result<ValidatedAgentGraph, String> {
        let plan_id = self.id.trim();
        if plan_id.is_empty() {
            return Err("orchestration graph id is required".to_string());
        }
        if self.nodes.is_empty() {
            return Err(format!("orchestration graph {plan_id} has no nodes"));
        }

        let mut nodes = BTreeMap::new();
        for node in &self.nodes {
            let normalized = normalize_node(node)?;
            if nodes.insert(normalized.id.clone(), normalized).is_some() {
                return Err(format!(
                    "orchestration graph {plan_id} contains duplicate node id: {}",
                    node.id.trim()
                ));
            }
        }

        let mut dependents = nodes
            .keys()
            .map(|id| (id.clone(), Vec::new()))
            .collect::<BTreeMap<_, _>>();
        let mut indegree = nodes
            .keys()
            .map(|id| (id.clone(), 0usize))
            .collect::<BTreeMap<_, _>>();

        for node in nodes.values() {
            for dependency in &node.depends_on {
                if dependency == &node.id {
                    return Err(format!(
                        "orchestration graph {plan_id} node {} cannot depend on itself",
                        node.id
                    ));
                }
                if !nodes.contains_key(dependency) {
                    return Err(format!(
                        "orchestration graph {plan_id} node {} depends on unknown node {dependency}",
                        node.id
                    ));
                }
                dependents
                    .get_mut(dependency)
                    .expect("dependency existence checked")
                    .push(node.id.clone());
                *indegree
                    .get_mut(&node.id)
                    .expect("node indegree initialized") += 1;
            }
        }

        for values in dependents.values_mut() {
            values.sort();
        }

        let topological_order = topological_order(&indegree, &dependents);
        if topological_order.len() != nodes.len() {
            let unresolved = indegree
                .keys()
                .filter(|node_id| !topological_order.contains(node_id))
                .cloned()
                .collect::<Vec<_>>();
            return Err(format!(
                "orchestration graph {plan_id} contains a dependency cycle involving: {}",
                unresolved.join(", ")
            ));
        }

        Ok(ValidatedAgentGraph {
            nodes,
            dependents,
            indegree,
            topological_order,
        })
    }
}

impl ValidatedAgentGraph {
    /// Nodes that can be dispatched before any graph result exists.
    pub(crate) fn initial_ready_nodes(&self) -> Vec<&AgentGraphNode> {
        self.indegree
            .iter()
            .filter(|(_, degree)| **degree == 0)
            .filter_map(|(node_id, _)| self.nodes.get(node_id))
            .collect()
    }

    /// Resolve nodes that become ready after the supplied completed node set.
    ///
    /// This is a pure projection helper; the future scheduler remains responsible for terminal
    /// status policy and actual Bridge dispatch.
    pub(crate) fn ready_nodes<'a>(
        &'a self,
        completed: &BTreeSet<String>,
        already_started: &BTreeSet<String>,
    ) -> Vec<&'a AgentGraphNode> {
        self.topological_order
            .iter()
            .filter(|node_id| !already_started.contains(*node_id))
            .filter_map(|node_id| self.nodes.get(node_id))
            .filter(|node| node.depends_on.iter().all(|dependency| completed.contains(dependency)))
            .collect()
    }
}

fn normalize_node(node: &AgentGraphNode) -> Result<AgentGraphNode, String> {
    let id = node.id.trim().to_string();
    if id.is_empty() {
        return Err("orchestration graph node id is required".to_string());
    }
    let target_engine_id = node.target_engine_id.trim().to_ascii_lowercase();
    if target_engine_id.is_empty() {
        return Err(format!("orchestration graph node {id} target engine is required"));
    }
    let task = node.task.trim().to_string();
    if task.is_empty() {
        return Err(format!("orchestration graph node {id} task is required"));
    }

    let mut dependency_set = BTreeSet::new();
    for dependency in &node.depends_on {
        let dependency = dependency.trim();
        if dependency.is_empty() {
            return Err(format!(
                "orchestration graph node {id} contains an empty dependency"
            ));
        }
        dependency_set.insert(dependency.to_string());
    }

    let file_refs = node
        .file_refs
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect();

    Ok(AgentGraphNode {
        id,
        target_engine_id,
        task,
        depends_on: dependency_set.into_iter().collect(),
        file_refs,
        context_policy: node.context_policy,
        execution_scope: node.execution_scope,
    })
}

fn topological_order(
    indegree: &BTreeMap<String, usize>,
    dependents: &BTreeMap<String, Vec<String>>,
) -> Vec<String> {
    let mut remaining = indegree.clone();
    let mut queue = remaining
        .iter()
        .filter(|(_, degree)| **degree == 0)
        .map(|(node_id, _)| node_id.clone())
        .collect::<VecDeque<_>>();
    let mut ordered = Vec::with_capacity(remaining.len());

    while let Some(node_id) = queue.pop_front() {
        ordered.push(node_id.clone());
        for dependent in dependents.get(&node_id).into_iter().flatten() {
            let degree = remaining
                .get_mut(dependent)
                .expect("dependent indegree initialized");
            *degree = degree.saturating_sub(1);
            if *degree == 0 {
                queue.push_back(dependent.clone());
            }
        }
    }
    ordered
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, depends_on: &[&str]) -> AgentGraphNode {
        AgentGraphNode {
            id: id.to_string(),
            target_engine_id: "codex".to_string(),
            task: format!("task-{id}"),
            depends_on: depends_on.iter().map(|value| value.to_string()).collect(),
            file_refs: Vec::new(),
            context_policy: DelegationContextPolicy::Explicit,
            execution_scope: DelegationExecutionScope::Observe,
        }
    }

    #[test]
    fn validates_parallel_fan_out_and_join() {
        let graph = AgentGraphPlan {
            id: "review-pipeline".to_string(),
            nodes: vec![
                node("implement", &[]),
                node("review-code", &["implement"]),
                node("review-arch", &["implement"]),
                node("finalize", &["review-code", "review-arch"]),
            ],
        }
        .validate()
        .expect("valid graph");

        assert_eq!(
            graph
                .initial_ready_nodes()
                .into_iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
            vec!["implement"]
        );

        let completed = BTreeSet::from(["implement".to_string()]);
        let started = BTreeSet::from(["implement".to_string()]);
        assert_eq!(
            graph
                .ready_nodes(&completed, &started)
                .into_iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
            vec!["review-arch", "review-code"]
        );
    }

    #[test]
    fn rejects_unknown_dependency() {
        let error = AgentGraphPlan {
            id: "invalid".to_string(),
            nodes: vec![node("review", &["missing"])],
        }
        .validate()
        .expect_err("unknown dependency must fail");
        assert!(error.contains("unknown node missing"));
    }

    #[test]
    fn rejects_dependency_cycle() {
        let error = AgentGraphPlan {
            id: "cycle".to_string(),
            nodes: vec![node("a", &["b"]), node("b", &["a"])],
        }
        .validate()
        .expect_err("cycle must fail");
        assert!(error.contains("dependency cycle"));
    }

    #[test]
    fn normalizes_dependencies_and_engine_id() {
        let graph = AgentGraphPlan {
            id: "normalize".to_string(),
            nodes: vec![
                AgentGraphNode {
                    id: " root ".to_string(),
                    target_engine_id: " CODEX ".to_string(),
                    task: " implement ".to_string(),
                    depends_on: Vec::new(),
                    file_refs: vec![" src/lib.rs ".to_string(), " ".to_string()],
                    context_policy: DelegationContextPolicy::Explicit,
                    execution_scope: DelegationExecutionScope::Observe,
                },
                node("review", &["root", " root ", "root"]),
            ],
        }
        .validate()
        .expect("valid normalized graph");

        let root = graph.nodes.get("root").expect("root");
        assert_eq!(root.target_engine_id, "codex");
        assert_eq!(root.task, "implement");
        assert_eq!(root.file_refs, vec!["src/lib.rs"]);
        assert_eq!(graph.nodes["review"].depends_on, vec!["root"]);
    }
}
