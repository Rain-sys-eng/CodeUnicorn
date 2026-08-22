use super::*;

impl ClaudeSession {
    pub(super) fn summarize_user_input_response(result: &Value) -> (usize, usize, bool) {
        let answer_count = result
            .get("answers")
            .and_then(|answers| answers.as_object())
            .map(|answers| answers.len())
            .unwrap_or(0);
        let non_empty_answer_count = result
            .get("answers")
            .and_then(|answers| answers.as_object())
            .map(|answers| {
                answers
                    .values()
                    .filter(|entry| {
                        entry
                            .get("answers")
                            .and_then(|answers| answers.as_array())
                            .map(|values| {
                                values.iter().any(|value| {
                                    value
                                        .as_str()
                                        .map(|text| !text.trim().is_empty())
                                        .unwrap_or(false)
                                })
                            })
                            .unwrap_or(false)
                    })
                    .count()
            })
            .unwrap_or(0);
        let has_skipped_questions = result
            .get("skippedQuestionIds")
            .or_else(|| result.get("skipped_question_ids"))
            .and_then(|value| value.as_array())
            .map(|values| !values.is_empty())
            .unwrap_or(false);
        (answer_count, non_empty_answer_count, has_skipped_questions)
    }

    async fn stop_child_after_resume_failure(
        &self,
        turn_id: &str,
        mut child: Child,
        message: String,
    ) -> String {
        log::error!("{}", message);
        if let Err(error) = self.terminate_child_process(turn_id, &mut child).await {
            log::debug!(
                "[claude] Failed to terminate resume child after AskUserQuestion error (turn={}): {}",
                turn_id,
                error
            );
        }
        message
    }

    async fn terminate_active_child_for_resume_failure(
        &self,
        turn_id: &str,
        context: &str,
    ) -> Result<(), String> {
        let mut existing_child = {
            let mut active = self.active_processes.lock().await;
            active.remove(turn_id)
        };
        if let Some(mut child) = existing_child.take() {
            self.terminate_child_process(turn_id, &mut child)
                .await
                .map_err(|error| {
                    format!(
                        "{}; additionally failed to terminate active Claude process: {}",
                        context, error
                    )
                })?;
        }
        Ok(())
    }

    fn get_or_create_user_input_notify(&self, turn_id: &str) -> Arc<Notify> {
        if let Ok(mut map) = self.user_input_notify_by_turn.lock() {
            if let Some(existing) = map.get(turn_id) {
                return existing.clone();
            }
            let notify = Arc::new(Notify::new());
            map.insert(turn_id.to_string(), notify.clone());
            return notify;
        }
        Arc::new(Notify::new())
    }

    fn get_or_create_approval_notify(&self, turn_id: &str) -> Arc<Notify> {
        if let Ok(mut map) = self.approval_notify_by_turn.lock() {
            if let Some(existing) = map.get(turn_id) {
                return existing.clone();
            }
            let notify = Arc::new(Notify::new());
            map.insert(turn_id.to_string(), notify.clone());
            return notify;
        }
        Arc::new(Notify::new())
    }

    fn clear_pending_user_inputs_for_turn(&self, turn_id: &str) {
        if let Ok(mut pending) = self.pending_user_inputs.lock() {
            pending.retain(|_, value| value != turn_id);
        }
        if let Ok(mut pending) = self.pending_approval_requests.lock() {
            pending.retain(|_, value| value != turn_id);
        }
        if let Ok(mut notifies) = self.user_input_notify_by_turn.lock() {
            notifies.remove(turn_id);
        }
        if let Ok(mut answers) = self.user_input_answer_by_turn.lock() {
            answers.remove(turn_id);
        }
        if let Ok(mut request_ids) = self.user_input_request_id_by_turn.lock() {
            request_ids.remove(turn_id);
        }
        if let Ok(mut diagnostics) = self.pending_user_input_resume_diagnostic_by_turn.lock() {
            diagnostics.remove(turn_id);
        }
        if let Ok(mut thread_ids) = self.thread_id_by_turn.lock() {
            thread_ids.remove(turn_id);
        }
        if let Ok(mut notifies) = self.approval_notify_by_turn.lock() {
            notifies.remove(turn_id);
        }
        if let Ok(mut messages) = self.approval_resume_message_by_turn.lock() {
            messages.remove(turn_id);
        }
    }

    pub(super) fn clear_turn_ephemeral_state(&self, turn_id: &str) {
        if let Ok(mut map) = self.last_emitted_text_by_turn.lock() {
            map.remove(turn_id);
        }
        if let Ok(mut map) = self.emitted_runtime_model_by_turn.lock() {
            map.remove(turn_id);
        }
        if let Ok(mut summaries) = self.synthetic_approval_summaries_by_turn.lock() {
            summaries.remove(turn_id);
        }
        if let Ok(mut environments) = self.provider_env_by_turn.lock() {
            environments.remove(turn_id);
        }
        self.clear_pending_user_inputs_for_turn(turn_id);
    }

    pub(super) async fn handle_file_approval_resume(
        &self,
        turn_id: &str,
        params: &SendMessageParams,
        new_session_id: &Option<String>,
        include_hook_events: bool,
        provider_settings_path: Option<&Path>,
    ) -> Result<Option<tokio::io::Lines<BufReader<tokio::process::ChildStdout>>>, String> {
        let notify = self.get_or_create_approval_notify(turn_id);
        log::info!("File approval detected, waiting for approval resolution (up to 5 min)...");

        let mut existing_child = {
            let mut active = self.active_processes.lock().await;
            active.remove(turn_id)
        };
        if let Some(mut child) = existing_child.take() {
            if let Err(error) = self.terminate_child_process(turn_id, &mut child).await {
                log::debug!(
                    "[claude] Failed to terminate approval-blocked process (turn={}): {}",
                    turn_id,
                    error
                );
            }
        }

        let approvals_resolved = tokio::select! {
            _ = notify.notified() => true,
            _ = tokio::time::sleep(
                std::time::Duration::from_secs(300)
            ) => false,
        };

        if !approvals_resolved {
            self.clear_pending_user_inputs_for_turn(turn_id);
            return Err("Approval timed out before Claude could resume.".to_string());
        }

        let resume_text = self
            .approval_resume_message_by_turn
            .lock()
            .ok()
            .and_then(|mut map| map.remove(turn_id));

        let answer = match resume_text {
            Some(text) if !text.trim().is_empty() => text,
            _ => {
                return Err("Approval resolved but missing Claude resume context.".to_string());
            }
        };

        let sid = match new_session_id.clone() {
            Some(value) => value,
            None => {
                return Err("No session_id available for Claude approval resume.".to_string());
            }
        };

        let mut resume_params = params.clone();
        resume_params.text = answer;
        resume_params.continue_session = true;
        resume_params.session_id = Some(sid);
        resume_params.images = None;
        if self.is_disposed() {
            return Err("Claude session disposed; refusing approval resume spawn".to_string());
        }
        let use_stream_json_input = Self::should_use_stream_json_input(&resume_params);

        let provider_env = self.provider_env_for_turn(turn_id);
        let mut cmd = self.build_command_with_provider_env(
            &resume_params,
            use_stream_json_input,
            include_hook_events,
            None,
            None,
            provider_env.as_ref(),
            provider_settings_path,
        );
        Self::configure_spawn_command(&mut cmd);
        match cmd.spawn() {
            Ok(mut new_child) => {
                if use_stream_json_input {
                    if let Some(mut stdin) = new_child.stdin.take() {
                        let message = match build_message_content(&resume_params) {
                            Ok(value) => value,
                            Err(error) => {
                                let failure = self
                                    .stop_child_after_resume_failure(
                                        turn_id,
                                        new_child,
                                        format!(
                                            "Failed to build approval resume message: {}",
                                            error
                                        ),
                                    )
                                    .await;
                                return Err(failure);
                            }
                        };
                        let message_str = match serde_json::to_string(&message) {
                            Ok(value) => value,
                            Err(error) => {
                                let failure = self
                                    .stop_child_after_resume_failure(
                                        turn_id,
                                        new_child,
                                        format!(
                                            "Failed to serialize approval resume message: {}",
                                            error
                                        ),
                                    )
                                    .await;
                                return Err(failure);
                            }
                        };
                        if let Err(error) = stdin.write_all(message_str.as_bytes()).await {
                            let failure = self
                                .stop_child_after_resume_failure(
                                    turn_id,
                                    new_child,
                                    format!(
                                        "Failed to write approval resume message to stdin: {}",
                                        error
                                    ),
                                )
                                .await;
                            return Err(failure);
                        }
                        if let Err(error) = stdin.write_all(b"\n").await {
                            let failure = self
                                .stop_child_after_resume_failure(
                                    turn_id,
                                    new_child,
                                    format!(
                                        "Failed to write approval resume newline to stdin: {}",
                                        error
                                    ),
                                )
                                .await;
                            return Err(failure);
                        }
                        drop(stdin);
                    } else {
                        let failure = self
                            .stop_child_after_resume_failure(
                                turn_id,
                                new_child,
                                "Resume process missing stdin in stream-json mode".to_string(),
                            )
                            .await;
                        return Err(failure);
                    }
                } else {
                    drop(new_child.stdin.take());
                }

                let new_lines = new_child
                    .stdout
                    .take()
                    .map(|stdout| BufReader::new(stdout).lines());

                if let Some(new_stderr) = new_child.stderr.take() {
                    tokio::spawn(async move {
                        let mut r = BufReader::new(new_stderr).lines();
                        while let Ok(Some(_)) = r.next_line().await {}
                    });
                }

                let mut spawned_child = Some(new_child);
                {
                    let mut active = self.active_processes.lock().await;
                    if !self.is_disposed() {
                        if let Some(child) = spawned_child.take() {
                            active.insert(turn_id.to_string(), child);
                        }
                    }
                }
                if let Some(mut child) = spawned_child.take() {
                    let _ = self.terminate_child_process(turn_id, &mut child).await;
                    return Err(
                        "Claude session disposed during approval resume; terminated pending child process"
                            .to_string(),
                    );
                }

                log::info!("Resumed Claude after approval resolution");
                Ok(new_lines)
            }
            Err(error) => Err(format!(
                "Failed to spawn Claude approval resume process: {}",
                error
            )),
        }
    }

    /// Convert an AskUserQuestion tool_use input into a RequestUserInput engine event.
    /// The input from AskUserQuestion contains a `questions` array with `question`, `header`,
    /// `options` (each with `label` and `description`), and optional `multiSelect` flag.
    /// We transform this into the `item/tool/requestUserInput` format that the frontend expects.
    pub(super) fn convert_ask_user_question_to_request(
        &self,
        tool_id: &str,
        input: &Value,
        turn_id: &str,
    ) -> Option<EngineEvent> {
        let raw_questions = input.get("questions").and_then(|q| q.as_array())?;
        let mut questions = Vec::new();
        for (idx, raw_q) in raw_questions.iter().enumerate() {
            let question_text = raw_q.get("question").and_then(|v| v.as_str()).unwrap_or("");
            let header = raw_q.get("header").and_then(|v| v.as_str()).unwrap_or("");
            let multi_select = raw_q
                .get("multiSelect")
                .or_else(|| raw_q.get("multi_select"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            // AskUserQuestion always allows a free-text "Other" option
            let is_other = true;
            let raw_options = raw_q
                .get("options")
                .and_then(|o| o.as_array())
                .cloned()
                .unwrap_or_default();
            let options: Vec<Value> = raw_options
                .into_iter()
                .filter_map(|opt| {
                    let label = opt.get("label")?.as_str()?.to_string();
                    let desc = opt
                        .get("description")
                        .and_then(|d| d.as_str())
                        .unwrap_or("")
                        .to_string();
                    if label.is_empty() {
                        return None;
                    }
                    Some(json!({ "label": label, "description": desc }))
                })
                .collect();
            questions.push(json!({
                "id": format!("q-{}", idx),
                "header": header,
                "question": question_text,
                "isOther": is_other,
                "isSecret": false,
                "multiSelect": multi_select,
                "options": if options.is_empty() { Value::Null } else { Value::Array(options) },
            }));
        }

        if questions.is_empty() {
            return None;
        }

        // Use a string request_id derived from the tool_id via DefaultHasher.
        // A numeric i64 can lose precision when transported through JS.
        use std::hash::{Hash, Hasher};
        let request_id = {
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            tool_id.hash(&mut hasher);
            format!("ask-{:016x}", hasher.finish())
        };

        // Already settled (user answered / skipped): emit completed lifecycle only.
        // Do not re-register pending or re-enter kill+resume wait.
        if self.is_user_input_request_settled(&request_id) {
            return Some(EngineEvent::RequestUserInput {
                workspace_id: self.workspace_id.clone(),
                request_id: Value::String(request_id),
                questions: Value::Array(Vec::new()),
                completed: true,
            });
        }

        if let Ok(mut pending) = self.pending_user_inputs.lock() {
            pending.insert(request_id.clone(), turn_id.to_string());
        }

        Some(EngineEvent::RequestUserInput {
            workspace_id: self.workspace_id.clone(),
            request_id: Value::String(request_id),
            questions: Value::Array(questions),
            completed: false,
        })
    }

    const SETTLED_USER_INPUT_REQUEST_ID_CAP: usize = 2048;

    fn is_user_input_request_settled(&self, request_id_key: &str) -> bool {
        self.settled_user_input_request_ids
            .lock()
            .ok()
            .map(|set| set.contains(request_id_key))
            .unwrap_or(false)
    }

    fn mark_user_input_request_settled(&self, request_id_key: &str) {
        if request_id_key.is_empty() {
            return;
        }
        if let Ok(mut set) = self.settled_user_input_request_ids.lock() {
            if set.len() >= Self::SETTLED_USER_INPUT_REQUEST_ID_CAP && !set.contains(request_id_key)
            {
                set.clear();
            }
            set.insert(request_id_key.to_string());
        }
    }

    fn emit_user_input_request_completed(&self, turn_id: &str, request_id_key: &str) {
        self.emit_turn_event(
            turn_id,
            EngineEvent::RequestUserInput {
                workspace_id: self.workspace_id.clone(),
                request_id: Value::String(request_id_key.to_string()),
                questions: Value::Array(Vec::new()),
                completed: true,
            },
        );
    }

    fn normalize_request_id_key(request_id: &Value) -> Option<String> {
        if let Some(text) = request_id.as_str() {
            let normalized = text.trim();
            if !normalized.is_empty() {
                return Some(normalized.to_string());
            }
        }
        if let Some(value) = request_id.as_i64() {
            return Some(value.to_string());
        }
        if let Some(value) = request_id.as_u64() {
            return Some(value.to_string());
        }
        None
    }

    pub fn has_pending_user_input(&self, request_id: &Value) -> bool {
        let request_id_key = match Self::normalize_request_id_key(request_id) {
            Some(value) => value,
            None => return false,
        };
        let in_pending = self
            .pending_user_inputs
            .lock()
            .ok()
            .map(|pending| pending.contains_key(&request_id_key))
            .unwrap_or(false);
        if in_pending {
            return true;
        }
        let waiters = match self.mcp_answer_waiters.lock() {
            Ok(value) => value,
            Err(_) => return false,
        };
        // Exact waiter key, or sole outstanding MCP ask (identity recovery for skip/submit).
        waiters.contains_key(&request_id_key) || waiters.len() == 1
    }

    #[cfg(test)]
    pub fn has_any_pending_user_input(&self) -> bool {
        self.pending_user_inputs
            .lock()
            .ok()
            .map(|pending| !pending.is_empty())
            .unwrap_or(false)
    }

    /// Handle the AskUserQuestion flow: wait for user response, then kill the
    /// current CLI process and restart it with `--resume` carrying the user's
    /// actual answer.
    ///
    /// Returns the new stdout `Lines` reader if successfully resumed.
    /// `Ok(None)` means we should continue reading from the current process.
    /// `Err` means resume failed after the original process was already terminated.
    pub(super) async fn handle_ask_user_question_resume(
        &self,
        turn_id: &str,
        params: &SendMessageParams,
        new_session_id: &Option<String>,
        include_hook_events: bool,
        provider_settings_path: Option<&Path>,
    ) -> Result<Option<tokio::io::Lines<BufReader<tokio::process::ChildStdout>>>, String> {
        let notify = self.get_or_create_user_input_notify(turn_id);
        log::info!("AskUserQuestion detected, waiting for user (up to 30 min)…");
        let user_answered = tokio::select! {
            _ = notify.notified() => true,
            _ = tokio::time::sleep(
                std::time::Duration::from_secs(ASK_USER_QUESTION_TIMEOUT_SECS)
            ) => false,
        };

        if !user_answered {
            log::info!("AskUserQuestion timed out (30 min), resuming original");
            self.clear_pending_user_inputs_for_turn(turn_id);
            return Ok(None);
        }

        // Grab the formatted answer for this turn only.
        let answer_text = self
            .user_input_answer_by_turn
            .lock()
            .ok()
            .and_then(|mut map| map.remove(turn_id));

        let answer = match answer_text {
            Some(a) => a,
            None => return Ok(None),
        };
        let resume_request_id = self.take_user_input_request_id_for_turn(turn_id);

        let (resume_bin, resume_wrapper_kind) = self.cli_binary_diagnostics();
        log::info!(
            "Claude engine: AskUserQuestion resume checkpoint (turn_id={}, wrapper_kind={}, bin={})",
            turn_id,
            resume_wrapper_kind,
            resume_bin
        );

        // We need a session_id for --resume
        let sid = match new_session_id.clone() {
            Some(s) => s,
            None => {
                let mut error = format!(
                    "AskUserQuestion answer accepted but no Claude session_id is available for --resume (turn_id={}, wrapper_kind={}, bin={})",
                    turn_id,
                    resume_wrapper_kind,
                    resume_bin
                );
                if let Err(termination_error) = self
                    .terminate_active_child_for_resume_failure(turn_id, &error)
                    .await
                {
                    error = termination_error;
                }
                self.emit_ask_user_question_resume_diagnostic(
                    turn_id,
                    resume_request_id.clone(),
                    false,
                    Some(error.clone()),
                );
                return Err(error);
            }
        };

        log::info!(
            "Killing current CLI and restarting with --resume \
             to deliver user's answer"
        );

        // Kill the current process (move child handle out of map first to avoid
        // awaiting termination while holding the shared process lock).
        let mut existing_child = {
            let mut active = self.active_processes.lock().await;
            active.remove(turn_id)
        };
        let parent_pid = existing_child
            .as_ref()
            .and_then(|child| child.id())
            .map(|pid| pid.to_string())
            .unwrap_or_else(|| "none".to_string());
        log::info!(
            "Claude engine: terminating AskUserQuestion parent before resume (turn_id={}, parent_pid={}, wrapper_kind={})",
            turn_id,
            parent_pid,
            resume_wrapper_kind
        );
        if let Some(mut child) = existing_child.take() {
            if let Err(error) = self.terminate_child_process(turn_id, &mut child).await {
                let failure = format!(
                    "Failed to terminate AskUserQuestion parent process before resume (turn_id={}, parent_pid={}, wrapper_kind={}, bin={}): {}",
                    turn_id,
                    parent_pid,
                    resume_wrapper_kind,
                    resume_bin,
                    error
                );
                self.emit_ask_user_question_resume_diagnostic(
                    turn_id,
                    resume_request_id.clone(),
                    false,
                    Some(failure.clone()),
                );
                return Err(failure);
            }
        }

        // Build a resume command with the user's answer
        let mut resume_params = params.clone();
        resume_params.text = answer;
        resume_params.continue_session = true;
        resume_params.session_id = Some(sid);
        resume_params.images = None;
        if self.is_disposed() {
            let error =
                "Claude session disposed; refusing AskUserQuestion resume spawn".to_string();
            self.emit_ask_user_question_resume_diagnostic(
                turn_id,
                resume_request_id.clone(),
                false,
                Some(error.clone()),
            );
            return Err(error);
        }
        let use_stream_json_input = Self::should_use_stream_json_input(&resume_params);

        let provider_env = self.provider_env_for_turn(turn_id);
        let mut cmd = self.build_command_with_provider_env(
            &resume_params,
            use_stream_json_input,
            include_hook_events,
            None,
            None,
            provider_env.as_ref(),
            provider_settings_path,
        );
        Self::configure_spawn_command(&mut cmd);
        match cmd.spawn() {
            Ok(mut new_child) => {
                if use_stream_json_input {
                    if let Some(mut stdin) = new_child.stdin.take() {
                        let message = match build_message_content(&resume_params) {
                            Ok(value) => value,
                            Err(error) => {
                                let failure = self
                                    .stop_child_after_resume_failure(
                                        turn_id,
                                        new_child,
                                        format!(
                                            "Failed to build AskUserQuestion resume message: {}",
                                            error
                                        ),
                                    )
                                    .await;
                                self.emit_ask_user_question_resume_diagnostic(
                                    turn_id,
                                    resume_request_id.clone(),
                                    false,
                                    Some(failure.clone()),
                                );
                                return Err(failure);
                            }
                        };
                        let message_str = match serde_json::to_string(&message) {
                            Ok(value) => value,
                            Err(error) => {
                                let failure = self
                                    .stop_child_after_resume_failure(
                                        turn_id,
                                        new_child,
                                        format!(
                                            "Failed to serialize AskUserQuestion resume message: {}",
                                            error
                                        ),
                                    )
                                    .await;
                                self.emit_ask_user_question_resume_diagnostic(
                                    turn_id,
                                    resume_request_id.clone(),
                                    false,
                                    Some(failure.clone()),
                                );
                                return Err(failure);
                            }
                        };
                        if let Err(error) = stdin.write_all(message_str.as_bytes()).await {
                            let failure = self
                                .stop_child_after_resume_failure(
                                    turn_id,
                                    new_child,
                                    format!(
                                        "Failed to write AskUserQuestion resume message to stdin: {}",
                                        error
                                    ),
                                )
                                .await;
                            self.emit_ask_user_question_resume_diagnostic(
                                turn_id,
                                resume_request_id.clone(),
                                false,
                                Some(failure.clone()),
                            );
                            return Err(failure);
                        }
                        if let Err(error) = stdin.write_all(b"\n").await {
                            let failure = self
                                .stop_child_after_resume_failure(
                                    turn_id,
                                    new_child,
                                    format!(
                                        "Failed to write AskUserQuestion resume newline to stdin: {}",
                                        error
                                    ),
                                )
                                .await;
                            self.emit_ask_user_question_resume_diagnostic(
                                turn_id,
                                resume_request_id.clone(),
                                false,
                                Some(failure.clone()),
                            );
                            return Err(failure);
                        }
                        drop(stdin);
                    } else {
                        let failure = self
                            .stop_child_after_resume_failure(
                                turn_id,
                                new_child,
                                "Resume process missing stdin in stream-json mode".to_string(),
                            )
                            .await;
                        self.emit_ask_user_question_resume_diagnostic(
                            turn_id,
                            resume_request_id.clone(),
                            false,
                            Some(failure.clone()),
                        );
                        return Err(failure);
                    }
                } else {
                    // Drop stdin immediately for non-stream-json resume requests.
                    drop(new_child.stdin.take());
                }

                let new_lines = match new_child.stdout.take() {
                    Some(stdout) => BufReader::new(stdout).lines(),
                    None => {
                        let failure = self
                            .stop_child_after_resume_failure(
                                turn_id,
                                new_child,
                                "AskUserQuestion resume process missing stdout".to_string(),
                            )
                            .await;
                        self.emit_ask_user_question_resume_diagnostic(
                            turn_id,
                            resume_request_id.clone(),
                            false,
                            Some(failure.clone()),
                        );
                        return Err(failure);
                    }
                };

                // Capture stderr of new process
                // (old stderr task will finish on its own)
                if let Some(new_stderr) = new_child.stderr.take() {
                    let _ws = self.workspace_id.clone();
                    tokio::spawn(async move {
                        let mut r = BufReader::new(new_stderr).lines();
                        while let Ok(Some(_)) = r.next_line().await {}
                    });
                }

                // Store new child for interruption
                let mut spawned_child = Some(new_child);
                {
                    let mut active = self.active_processes.lock().await;
                    if !self.is_disposed() {
                        if let Some(child) = spawned_child.take() {
                            active.insert(turn_id.to_string(), child);
                        }
                    }
                }
                if let Some(mut child) = spawned_child.take() {
                    let _ = self.terminate_child_process(turn_id, &mut child).await;
                    let error =
                        "Claude session disposed during AskUserQuestion resume; terminated pending child process"
                            .to_string();
                    self.emit_ask_user_question_resume_diagnostic(
                        turn_id,
                        resume_request_id.clone(),
                        false,
                        Some(error.clone()),
                    );
                    return Err(error);
                }

                log::info!(
                    "Resumed Claude with AskUserQuestion answer (turn_id={}, wrapper_kind={}, bin={})",
                    turn_id,
                    resume_wrapper_kind,
                    resume_bin
                );
                self.remember_pending_ask_user_question_resume_diagnostic(
                    turn_id,
                    resume_request_id.clone(),
                );
                Ok(Some(new_lines))
            }
            Err(e) => {
                let error = format!(
                    "Failed to spawn AskUserQuestion resume process (turn_id={}, wrapper_kind={}, bin={}): {}",
                    turn_id,
                    resume_wrapper_kind,
                    resume_bin,
                    e
                );
                self.emit_ask_user_question_resume_diagnostic(
                    turn_id,
                    resume_request_id.clone(),
                    false,
                    Some(error.clone()),
                );
                Err(error)
            }
        }
    }

    /// Handle a user's response to an AskUserQuestion dialog.
    ///
    /// The answer is formatted into a human-readable message and stored.
    /// The stdout reading loop will then kill the current CLI process
    /// (whose output is based on a default/empty AskUserQuestion result)
    /// and restart it with `--resume` carrying the user's actual answer.
    pub async fn respond_to_user_input(
        &self,
        request_id: Value,
        result: Value,
    ) -> Result<(), String> {
        let normalized_request_id = Self::normalize_request_id_key(&request_id);
        if normalized_request_id.is_none() {
            return Err("invalid request_id for AskUserQuestion".to_string());
        }

        // Strict request_id matching prevents cross-turn answer routing
        // when multiple AskUserQuestion prompts are pending.
        let request_id_key = normalized_request_id.unwrap_or_default();
        let answer_text = format_ask_user_answer(&result);

        // Always drop pending for this id if present (MCP or native).
        let pending_turn_id = {
            let mut pending = self
                .pending_user_inputs
                .lock()
                .map_err(|_| "pending_user_inputs lock poisoned".to_string())?;
            pending.remove(&request_id_key)
        };

        // MCP-origin (B2): prefer exact waiter match first.
        // If FE request_id drifts from the waiter key (history rehydrate / race),
        // fall back to the sole MCP waiter so skip/submit never leave the CLI hung.
        let mcp_delivery = self
            .take_mcp_answer_waiter(&request_id_key)
            .map(|sender| (request_id_key.clone(), sender))
            .or_else(|| self.take_sole_mcp_answer_waiter());

        if let Some((delivered_request_id, sender)) = mcp_delivery {
            let turn_id = pending_turn_id.unwrap_or_else(|| {
                self.active_turn_id()
                    .map(|id| id.as_str().to_string())
                    .unwrap_or_default()
            });
            let (answer_count, non_empty_answer_count, has_skipped_questions) =
                Self::summarize_user_input_response(&result);
            log::info!(
                "Claude engine: AskUserQuestion (MCP) response accepted (request_id={}, delivered_request_id={}, turn_id={}, answer_count={}, non_empty_answer_count={}, has_skipped_questions={}, orphan_recovered={})",
                request_id_key,
                delivered_request_id,
                turn_id,
                answer_count,
                non_empty_answer_count,
                has_skipped_questions,
                delivered_request_id != request_id_key
            );
            let _ = sender.send(answer_text);
            self.mark_user_input_request_settled(&request_id_key);
            self.mark_user_input_request_settled(&delivered_request_id);
            if !turn_id.is_empty() {
                self.emit_user_input_request_completed(&turn_id, &delivered_request_id);
                if delivered_request_id != request_id_key {
                    self.emit_user_input_request_completed(&turn_id, &request_id_key);
                }
            }
            return Ok(());
        }

        let Some(turn_id) = pending_turn_id else {
            return Err(format!(
                "unknown request_id for AskUserQuestion: {}",
                request_id_key
            ));
        };

        let (answer_count, non_empty_answer_count, has_skipped_questions) =
            Self::summarize_user_input_response(&result);
        log::info!(
            "Claude engine: AskUserQuestion response accepted (request_id={}, turn_id={}, answer_count={}, non_empty_answer_count={}, has_skipped_questions={})",
            request_id_key,
            turn_id,
            answer_count,
            non_empty_answer_count,
            has_skipped_questions
        );
        if let Ok(mut map) = self.user_input_answer_by_turn.lock() {
            map.insert(turn_id.clone(), answer_text);
        }
        if let Ok(mut map) = self.user_input_request_id_by_turn.lock() {
            map.insert(turn_id.clone(), request_id_key.clone());
        }

        // Signal only the matching turn's stdout loop to resume.
        self.get_or_create_user_input_notify(&turn_id).notify_one();
        self.mark_user_input_request_settled(&request_id_key);
        self.emit_user_input_request_completed(&turn_id, &request_id_key);

        Ok(())
    }

    /// Raise an AskUserQuestion via the in-process MCP tool (B2 path) and block
    /// until the user answers, returning the formatted tool_result text.
    ///
    /// Unlike the native plan-mode path, the answer is delivered by returning the
    /// MCP tool_result to the still-running CLI turn — no kill/`--resume`. The
    /// CLI is blocked awaiting our HTTP response while this future is pending, so
    /// `isProcessing` stays true and the dialog preempts the queued messages,
    /// exactly as with the native tool.
    ///
    /// The current live turn (whose event subscriber carries the RequestUserInput
    /// to the frontend) is resolved from `active_turn_id()`. `input` is the MCP
    /// tool's raw arguments (`{ questions: [...] }`), byte-identical to native.
    pub async fn ask_via_mcp(&self, input: &Value) -> Result<String, String> {
        let turn_id = self
            .active_turn_id()
            .ok_or_else(|| "no active turn for AskUserQuestion".to_string())?;
        let turn_id = turn_id.as_str();
        // Reuse the existing conversion so rendering + request_id derivation are
        // identical to the native path. A synthetic, unique tool_id keeps
        // concurrent asks within one turn from colliding.
        let tool_id = {
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            turn_id.hash(&mut hasher);
            (input as *const Value as usize).hash(&mut hasher);
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
                .hash(&mut hasher);
            format!("mcp-ask-{:016x}", hasher.finish())
        };

        let event = self
            .convert_ask_user_question_to_request(&tool_id, input, turn_id)
            .ok_or_else(|| "AskUserQuestion input had no valid questions".to_string())?;

        // Pull the request_id back out of the event so we can register the waiter
        // under the same key the frontend answer will arrive with.
        let (request_id, already_settled) = match &event {
            EngineEvent::RequestUserInput {
                request_id,
                completed,
                ..
            } => {
                let id = request_id
                    .as_str()
                    .map(ToOwned::to_owned)
                    .ok_or_else(|| "RequestUserInput request_id was not a string".to_string())?;
                (id, *completed)
            }
            _ => return Err("expected RequestUserInput event".to_string()),
        };

        // Settled identity re-entry: emit completed lifecycle only and return a
        // continue prompt so the CLI MCP call cannot hang forever without a waiter.
        if already_settled {
            self.emit_turn_event(turn_id, event);
            return Ok(
                "The user already answered or skipped this AskUserQuestion. Do not ask the same question again; continue the original task using the available context and reasonable assumptions."
                    .to_string(),
            );
        }

        let (tx, rx) = tokio::sync::oneshot::channel::<String>();
        if let Ok(mut waiters) = self.mcp_answer_waiters.lock() {
            waiters.insert(request_id.clone(), tx);
        }

        // Emit to the live turn's subscriber → existing React dialog.
        self.emit_turn_event(turn_id, event);

        // Block until the answer arrives (or the native 5-min bound elapses).
        // Keep in lockstep with USER_INPUT_TIMEOUT_SECONDS (30 min) on the FE card.
        let answer = match tokio::time::timeout(
            std::time::Duration::from_secs(ASK_USER_QUESTION_TIMEOUT_SECS),
            rx,
        )
        .await
        {
            Ok(Ok(text)) => text,
            Ok(Err(_)) => {
                // Sender dropped without answering.
                self.clear_mcp_answer_waiter(&request_id);
                return Err("AskUserQuestion answer channel closed".to_string());
            }
            Err(_) => {
                self.clear_mcp_answer_waiter(&request_id);
                // Also drop the pending_user_inputs entry so a late answer is rejected.
                if let Ok(mut pending) = self.pending_user_inputs.lock() {
                    pending.remove(&request_id);
                }
                self.mark_user_input_request_settled(&request_id);
                // Tell the frontend to dismiss the now-dead dialog (completed=true
                // is the removal signal). Without this the card lingers forever.
                self.emit_user_input_request_completed(turn_id, &request_id);
                return Err("AskUserQuestion timed out after 30 minutes".to_string());
            }
        };

        Ok(answer)
    }

    /// Take the MCP answer waiter for `request_id`, if this request is MCP-origin.
    /// Returns the oneshot sender so the caller can deliver the formatted answer.
    pub(super) fn take_mcp_answer_waiter(
        &self,
        request_id: &str,
    ) -> Option<tokio::sync::oneshot::Sender<String>> {
        self.mcp_answer_waiters
            .lock()
            .ok()
            .and_then(|mut waiters| waiters.remove(request_id))
    }

    /// Recovery: when FE request_id no longer matches the waiter key but there is
    /// exactly one outstanding MCP AskUserQuestion, deliver to that waiter so
    /// skip/submit cannot leave `mcp__ccgui__AskUserQuestion` spinning forever.
    fn take_sole_mcp_answer_waiter(
        &self,
    ) -> Option<(String, tokio::sync::oneshot::Sender<String>)> {
        let mut waiters = self.mcp_answer_waiters.lock().ok()?;
        if waiters.len() != 1 {
            return None;
        }
        let key = waiters.keys().next()?.clone();
        let sender = waiters.remove(&key)?;
        Some((key, sender))
    }

    fn clear_mcp_answer_waiter(&self, request_id: &str) {
        if let Ok(mut waiters) = self.mcp_answer_waiters.lock() {
            waiters.remove(request_id);
        }
    }
}
