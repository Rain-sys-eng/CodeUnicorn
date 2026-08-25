//! Declare image input on custom `llm-pi-ai` routes before `session.prompt`.
//!
//! DSH Host admits images from `resolveModelInfo().inputModalities`, not from
//! whether the upstream API can see. Hand-declared routes fall back to
//! `defaultInput: [text]`. mossx writes only that modality claim.

use super::host::DshHostClient;
use serde_json::{json, Value};

const PI_AI_NS: &str = "llm-pi-ai";
const TEXT_AND_IMAGE: [&str; 2] = ["text", "image"];

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ImageAdmissionPlan {
    Noop,
    Mutate {
        ns: String,
        ops: Vec<Value>,
        expected_revision: u64,
    },
    Reject(String),
}

pub(crate) fn selection_from_describe(describe: &Value) -> Option<(String, String)> {
    let provider = describe
        .get("provider")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let model = describe
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    Some((provider.to_string(), model.to_string()))
}

pub(crate) fn plan_image_admission(
    settings_describe: &Value,
    llm_providers: &Value,
    provider: &str,
    model: &str,
) -> ImageAdmissionPlan {
    let provider = provider.trim();
    let model = model.trim();
    if provider.is_empty() || model.is_empty() {
        return ImageAdmissionPlan::Reject(
            "DSH image input needs a provider/model before mossx can declare vision".to_string(),
        );
    }

    match provider_settings_ns(llm_providers, provider) {
        Some(ns) if ns != PI_AI_NS => return ImageAdmissionPlan::Noop,
        Some(_) | None => {}
    }

    if settings_describe.get("writable").and_then(Value::as_bool) != Some(true) {
        return ImageAdmissionPlan::Reject(format!(
            "DSH settings are not writable, so mossx cannot declare image input for `{provider}/{model}`. Open DSH Settings on a local writable host and retry."
        ));
    }

    let Some(namespace) = find_namespace(settings_describe, PI_AI_NS) else {
        return ImageAdmissionPlan::Reject(format!(
            "DSH has no `{PI_AI_NS}` settings namespace, so mossx cannot declare image input for `{provider}/{model}`."
        ));
    };

    let value_profile = namespace
        .get("value")
        .and_then(|value| value.get("providers"))
        .and_then(|providers| providers.get(provider));
    let user_profile = namespace
        .get("user")
        .and_then(|value| value.get("providers"))
        .and_then(|providers| providers.get(provider));

    if value_profile.is_none() && user_profile.is_none() {
        return ImageAdmissionPlan::Reject(format!(
            "DSH has no `{PI_AI_NS}` profile for `{provider}`, so mossx cannot invent one just to send an image. Configure that route in DSH Settings first."
        ));
    }

    if modalities_include_image(value_profile, model) {
        return ImageAdmissionPlan::Noop;
    }

    let Some(expected_revision) = json_u64(namespace.get("revision")) else {
        return ImageAdmissionPlan::Reject(
            "DSH settings.describe did not return a revision for llm-pi-ai".to_string(),
        );
    };

    let ops = if let Some(models) = user_models_array(user_profile) {
        if let Some(index) = model_index(models, model) {
            let mut next_models = models.clone();
            next_models[index] = with_image_input(&next_models[index]);
            vec![json!({
                "op": "set",
                "path": ["providers", provider, "models"],
                "value": next_models,
            })]
        } else {
            default_input_op(provider)
        }
    } else {
        default_input_op(provider)
    };

    ImageAdmissionPlan::Mutate {
        ns: PI_AI_NS.to_string(),
        ops,
        expected_revision,
    }
}

pub(crate) async fn ensure_image_admission(
    client: &DshHostClient,
    provider: &str,
    model: &str,
) -> Result<(), String> {
    let mut attempted_conflict_retry = false;
    loop {
        let settings = client.call("settings.describe", json!({})).await.map_err(|error| {
            format!(
                "mossx could not read DSH settings to declare image input for `{provider}/{model}`: {error}"
            )
        })?;
        let providers = client
            .call("llm.providers", json!({}))
            .await
            .unwrap_or_else(|_| json!({ "providers": [] }));

        match plan_image_admission(&settings, &providers, provider, model) {
            ImageAdmissionPlan::Noop => return Ok(()),
            ImageAdmissionPlan::Reject(reason) => return Err(reason),
            ImageAdmissionPlan::Mutate {
                ns,
                ops,
                expected_revision,
            } => {
                let payload = json!({
                    "ns": ns,
                    "ops": ops,
                    "expectedRevision": expected_revision,
                });
                match client.call("settings.mutate", payload).await {
                    Ok(_) => return Ok(()),
                    Err(error)
                        if !attempted_conflict_retry && error.contains("settings-conflict") =>
                    {
                        attempted_conflict_retry = true;
                        continue;
                    }
                    Err(error) => {
                        return Err(format!(
                            "mossx could not declare image input for `{provider}/{model}` on the DSH llm-pi-ai route: {error}"
                        ));
                    }
                }
            }
        }
    }
}

fn provider_settings_ns(llm_providers: &Value, provider: &str) -> Option<String> {
    llm_providers
        .get("providers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|entry| entry.get("provider").and_then(Value::as_str) == Some(provider))
        .and_then(|entry| {
            entry
                .get("settingsNs")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn find_namespace<'a>(settings_describe: &'a Value, ns: &str) -> Option<&'a Value> {
    settings_describe
        .get("namespaces")
        .and_then(Value::as_array)?
        .iter()
        .find(|entry| entry.get("ns").and_then(Value::as_str) == Some(ns))
}

fn user_models_array(user_profile: Option<&Value>) -> Option<&Vec<Value>> {
    user_profile
        .and_then(|profile| profile.get("models"))
        .and_then(Value::as_array)
}

fn model_index(models: &[Value], model: &str) -> Option<usize> {
    models
        .iter()
        .position(|entry| entry.get("id").and_then(Value::as_str).map(str::trim) == Some(model))
}

fn modalities_include_image(value_profile: Option<&Value>, model: &str) -> bool {
    if let Some(entry) = first_model_entry(value_profile, model) {
        if let Some(input) = entry.get("input").and_then(Value::as_array) {
            if !input.is_empty() {
                return input.iter().any(is_image_modality);
            }
        }
    }
    value_profile
        .and_then(|profile| profile.get("defaultInput"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(is_image_modality)
}

fn first_model_entry<'a>(profile: Option<&'a Value>, model: &str) -> Option<&'a Value> {
    profile
        .and_then(|value| value.get("models"))
        .and_then(Value::as_array)?
        .iter()
        .find(|entry| entry.get("id").and_then(Value::as_str).map(str::trim) == Some(model))
}

fn is_image_modality(value: &Value) -> bool {
    value.as_str() == Some("image")
}

fn with_image_input(entry: &Value) -> Value {
    let mut object = entry.as_object().cloned().unwrap_or_default();
    object.insert("input".to_string(), json!(TEXT_AND_IMAGE));
    Value::Object(object)
}

fn default_input_op(provider: &str) -> Vec<Value> {
    vec![json!({
        "op": "set",
        "path": ["providers", provider, "defaultInput"],
        "value": TEXT_AND_IMAGE,
    })]
}

fn json_u64(value: Option<&Value>) -> Option<u64> {
    let value = value?;
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|n| u64::try_from(n).ok()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn describe(writable: bool, revision: u64, value: Value, user: Option<Value>) -> Value {
        let mut namespace = json!({
            "ns": PI_AI_NS,
            "value": value,
            "revision": revision,
        });
        if let Some(user) = user {
            namespace["user"] = user;
        }
        json!({
            "writable": writable,
            "hasDocument": true,
            "namespaces": [namespace],
        })
    }

    fn providers(ns: &str) -> Value {
        json!({
            "providers": [{
                "provider": "grok",
                "displayName": "grok-4.6",
                "settingsNs": ns,
                "settingsPath": ["providers", "grok"],
                "active": true,
                "declared": true
            }]
        })
    }

    #[test]
    fn noops_when_model_entry_already_declares_image() {
        let settings = describe(
            true,
            3,
            json!({
                "providers": {
                    "grok": {
                        "defaultInput": ["text"],
                        "models": [{
                            "id": "grok-4.6",
                            "name": "Grok 4.6",
                            "input": ["text", "image"]
                        }]
                    }
                }
            }),
            Some(json!({
                "providers": {
                    "grok": {
                        "models": [{
                            "id": "grok-4.6",
                            "name": "Grok 4.6",
                            "input": ["text", "image"]
                        }]
                    }
                }
            })),
        );
        assert_eq!(
            plan_image_admission(&settings, &providers(PI_AI_NS), "grok", "grok-4.6"),
            ImageAdmissionPlan::Noop
        );
    }

    #[test]
    fn noops_when_default_input_already_covers_undescribed_model() {
        let settings = describe(
            true,
            1,
            json!({
                "providers": {
                    "grok": {
                        "defaultInput": ["text", "image"],
                        "models": [{ "id": "grok-4.6", "name": "Grok 4.6", "input": ["text", "image"] }]
                    }
                }
            }),
            Some(json!({
                "providers": {
                    "grok": { "displayName": "grok-4.6" }
                }
            })),
        );
        assert_eq!(
            plan_image_admission(&settings, &providers(PI_AI_NS), "grok", "grok-4.6"),
            ImageAdmissionPlan::Noop
        );
    }

    #[test]
    fn patches_model_entry_input_without_touching_sibling_fields() {
        let settings = describe(
            true,
            7,
            json!({
                "providers": {
                    "grok": {
                        "defaultInput": ["text"],
                        "models": [{
                            "id": "grok-4.6",
                            "name": "Grok 4.6",
                            "input": ["text"]
                        }]
                    }
                }
            }),
            Some(json!({
                "providers": {
                    "grok": {
                        "displayName": "grok-4.6",
                        "api": "openai-responses",
                        "models": [
                            { "id": "grok-4.5", "name": "Grok 4.5" },
                            { "id": "grok-4.6", "name": "Grok 4.6" }
                        ]
                    }
                }
            })),
        );
        match plan_image_admission(&settings, &providers(PI_AI_NS), "grok", "grok-4.6") {
            ImageAdmissionPlan::Mutate {
                ns,
                ops,
                expected_revision,
            } => {
                assert_eq!(ns, PI_AI_NS);
                assert_eq!(expected_revision, 7);
                assert_eq!(ops.len(), 1);
                assert_eq!(ops[0]["op"], "set");
                assert_eq!(ops[0]["path"], json!(["providers", "grok", "models"]));
                assert_eq!(ops[0]["value"][0]["id"], "grok-4.5");
                assert!(ops[0]["value"][0].get("input").is_none());
                assert_eq!(ops[0]["value"][1]["name"], "Grok 4.6");
                assert_eq!(ops[0]["value"][1]["input"], json!(["text", "image"]));
            }
            other => panic!("expected mutate, got {other:?}"),
        }
    }

    #[test]
    fn sets_route_default_input_when_models_list_is_absent() {
        let settings = describe(
            true,
            2,
            json!({
                "providers": {
                    "grok": {
                        "defaultInput": ["text"],
                        "models": [{ "id": "grok-4.6", "input": ["text"] }]
                    }
                }
            }),
            Some(json!({
                "providers": {
                    "grok": {
                        "displayName": "grok-4.6",
                        "api": "openai-responses",
                        "baseURL": "https://example.invalid/v1"
                    }
                }
            })),
        );
        match plan_image_admission(&settings, &providers(PI_AI_NS), "grok", "grok-4.6") {
            ImageAdmissionPlan::Mutate { ops, .. } => {
                assert_eq!(
                    ops,
                    vec![json!({
                        "op": "set",
                        "path": ["providers", "grok", "defaultInput"],
                        "value": ["text", "image"],
                    })]
                );
            }
            other => panic!("expected mutate, got {other:?}"),
        }
    }

    #[test]
    fn does_not_rewrite_official_deepseek_adapter() {
        let settings = describe(true, 1, json!({ "providers": {} }), None);
        assert_eq!(
            plan_image_admission(
                &settings,
                &json!({
                    "providers": [{
                        "provider": "deepseek-official",
                        "settingsNs": "llm-deepseek",
                        "settingsPath": [],
                        "active": true
                    }]
                }),
                "deepseek-official",
                "deepseek-v4-flash",
            ),
            ImageAdmissionPlan::Noop
        );
    }

    #[test]
    fn rejects_missing_pi_ai_profile() {
        let settings = describe(true, 1, json!({ "providers": {} }), None);
        match plan_image_admission(&settings, &providers(PI_AI_NS), "grok", "grok-4.6") {
            ImageAdmissionPlan::Reject(reason) => {
                assert!(reason.contains("no `llm-pi-ai` profile"), "{reason}");
                assert!(reason.contains("Configure that route"), "{reason}");
            }
            other => panic!("expected reject, got {other:?}"),
        }
    }

    #[test]
    fn rejects_read_only_host() {
        let settings = describe(
            false,
            1,
            json!({
                "providers": {
                    "grok": { "defaultInput": ["text"] }
                }
            }),
            Some(json!({
                "providers": { "grok": { "displayName": "grok" } }
            })),
        );
        match plan_image_admission(&settings, &providers(PI_AI_NS), "grok", "grok-4.6") {
            ImageAdmissionPlan::Reject(reason) => {
                assert!(reason.contains("not writable"), "{reason}");
            }
            other => panic!("expected reject, got {other:?}"),
        }
    }

    #[test]
    fn reads_current_selection_from_host_describe() {
        assert_eq!(
            selection_from_describe(&json!({ "provider": "grok", "model": "grok-4.6" })),
            Some(("grok".to_string(), "grok-4.6".to_string()))
        );
        assert_eq!(
            selection_from_describe(&json!({ "provider": "grok" })),
            None
        );
    }
}
