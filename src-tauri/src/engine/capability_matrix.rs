use super::{EngineFeatures, EngineType};

include!("capability_matrix.generated.rs");

pub const CAPABILITY_KEYS: [&str; 15] = [
    "streaming.text",
    "streaming.reasoning",
    "streaming.tool-output",
    "tool.use",
    "tool.mcp",
    "reasoning.effort",
    "collaboration.mode",
    "session.continuation",
    "image.input",
    "input.mid-turn",
    "session.resume",
    "session.fork",
    "session.switch",
    "session.tree",
    "rpc.server",
];

pub fn capability_state(engine_type: EngineType, capability: &str) -> &'static str {
    let features = match engine_type {
        EngineType::Claude => EngineFeatures::claude(),
        EngineType::Codex => EngineFeatures::codex(),
        EngineType::Gemini => EngineFeatures::gemini(),
        EngineType::Grok => EngineFeatures::grok(),
        EngineType::OpenCode => EngineFeatures::opencode(),
        EngineType::Kimi => EngineFeatures::kimi(),
        EngineType::Pi => EngineFeatures::pi(),
        EngineType::Dsh => EngineFeatures::dsh(),
        EngineType::Qoder => EngineFeatures::qoder(),
    };

    match capability {
        "streaming.text" => bool_state(features.streaming),
        "streaming.reasoning" => bool_state(features.streaming),
        // PI has tool start/end cards but does not stream tool_execution_update.
        "streaming.tool-output" => {
            if matches!(engine_type, EngineType::Pi) {
                "unsupported"
            } else {
                bool_state(features.streaming && features.tools_control)
            }
        }
        "tool.use" => bool_state(features.tools_control),
        "tool.mcp" => bool_state(features.mcp),
        "reasoning.effort" => bool_state(features.reasoning_effort),
        "collaboration.mode" => bool_state(features.collaboration_mode),
        "session.continuation" => bool_state(features.session_resume),
        "image.input" => bool_state(features.image_input),
        "session.resume" => bool_state(features.session_resume),
        "input.mid-turn" | "session.fork" | "session.switch" | "session.tree" | "rpc.server" => {
            "unknown"
        }
        _ => "unknown",
    }
}

fn bool_state(value: bool) -> &'static str {
    if value {
        "supported"
    } else {
        "unsupported"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_key_set_is_stable() {
        assert_eq!(
            CAPABILITY_KEYS,
            [
                "streaming.text",
                "streaming.reasoning",
                "streaming.tool-output",
                "tool.use",
                "tool.mcp",
                "reasoning.effort",
                "collaboration.mode",
                "session.continuation",
                "image.input",
                "input.mid-turn",
                "session.resume",
                "session.fork",
                "session.switch",
                "session.tree",
                "rpc.server",
            ]
        );
        assert_eq!(CAPABILITY_KEYS, SPEC_CAPABILITY_KEYS);
    }

    #[test]
    fn codex_supports_reasoning_effort_and_mcp() {
        assert_eq!(
            capability_state(EngineType::Codex, "reasoning.effort"),
            "supported"
        );
        assert_eq!(capability_state(EngineType::Codex, "tool.mcp"), "supported");
    }

    #[test]
    fn claude_supports_reasoning_effort() {
        assert_eq!(
            capability_state(EngineType::Claude, "reasoning.effort"),
            "supported"
        );
    }

    #[test]
    fn grok_supports_reasoning_effort() {
        assert_eq!(
            capability_state(EngineType::Grok, "reasoning.effort"),
            "supported"
        );
    }

    #[test]
    fn opencode_does_not_support_mcp_but_supports_image_input() {
        assert_eq!(
            capability_state(EngineType::OpenCode, "tool.mcp"),
            "unsupported"
        );
        assert_eq!(
            capability_state(EngineType::OpenCode, "image.input"),
            "supported"
        );
    }

    #[test]
    fn pi_supports_image_input_via_at_file_transport() {
        assert_eq!(
            spec_capability_state(EngineType::Pi, "image.input"),
            "supported"
        );
        assert_eq!(capability_state(EngineType::Pi, "image.input"), "supported");
    }

    #[test]
    fn pi_supports_thinking_effort() {
        assert_eq!(
            spec_capability_state(EngineType::Pi, "reasoning.effort"),
            "supported"
        );
        assert_eq!(
            capability_state(EngineType::Pi, "reasoning.effort"),
            "supported"
        );
    }

    #[test]
    fn pi_does_not_claim_live_tool_output() {
        assert_eq!(
            spec_capability_state(EngineType::Pi, "streaming.tool-output"),
            "unsupported"
        );
        assert_eq!(
            capability_state(EngineType::Pi, "streaming.tool-output"),
            "unsupported"
        );
        assert_eq!(
            spec_capability_state(EngineType::Pi, "tool.use"),
            "supported"
        );
    }

    #[test]
    fn generated_spec_stance_covers_foundation_capabilities() {
        assert_eq!(
            spec_capability_state(EngineType::Kimi, "input.mid-turn"),
            "unsupported"
        );
        assert_eq!(
            spec_capability_state(EngineType::Codex, "rpc.server"),
            "supported"
        );
        assert_eq!(
            spec_capability_state(EngineType::Claude, "session.fork"),
            "supported"
        );
    }
}
