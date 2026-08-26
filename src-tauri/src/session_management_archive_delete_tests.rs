    #[tokio::test]
    async fn archive_preserves_folder_assignment_and_active_filter_hides_session() {
        let base = std::env::temp_dir().join(format!("session-archive-folder-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let codex_home = base.join("codex-home");
        write_codex_session_fixture(&codex_home, "codex-keep", "/tmp/ws-1");
        let workspace = workspace_with_codex_home("ws-1", "Workspace", "/tmp/ws-1", &codex_home);
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let sessions = Mutex::new(HashMap::new());
        let engine_manager = engine::EngineManager::new();
        let folder = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-1".to_string(),
            "Keep".to_string(),
            None,
        )
        .await
        .expect("create folder")
        .folder;
        assign_workspace_session_folder_core(
            &workspaces,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            "codex-keep".to_string(),
            Some(folder.id.clone()),
        )
        .await
        .expect("assign session");

        crate::session_archive_v2::archive_workspace_sessions_v2_with_lookups(
            &workspaces,
            &sessions,
            &storage_path,
            "ws-1".to_string(),
            vec![crate::session_archive_v2::SessionArchiveV2Target {
                thread_id: "codex-keep".to_string(),
                engine: None,
            }],
            &HashMap::new(),
        )
        .await
        .expect("archive session");
        let metadata = read_catalog_metadata(&storage_path, "ws-1").expect("read metadata");
        assert_eq!(
            metadata
                .folder_id_by_session_id
                .get(&metadata_stable_key_for_session_id("ws-1", "codex-keep")),
            Some(&folder.id)
        );

        let entry = WorkspaceSessionCatalogEntry {
            archived_at: metadata
                .archived_at_by_session_id
                .get(&metadata_stable_key_for_session_id("ws-1", "codex-keep"))
                .copied(),
            ..catalog_entry("codex-keep", "ws-1", Some("Workspace"), None)
        };
        assert!(!entry_matches_status(
            &entry,
            SessionCatalogStatusFilter::Active
        ));
        assert!(entry_matches_status(
            &entry,
            SessionCatalogStatusFilter::Archived
        ));

        std::fs::remove_dir_all(base).ok();
    }
    #[tokio::test]
    async fn workspace_session_list_keyword_finds_match_beyond_first_scan_window() {
        let base = std::env::temp_dir().join(format!("session-keyword-deep-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let codex_home = base.join("codex-home");
        for index in 0..60 {
            let timestamp = codex_fixture_timestamp(index);
            let message = if index == 55 {
                "Needle regression"
            } else {
                "Ordinary session"
            };
            write_codex_session_fixture_with_message(
                &codex_home,
                &format!("codex-{index:03}"),
                "/tmp/ws-1",
                &timestamp,
                &timestamp,
                message,
            );
        }
        let workspace = workspace_with_codex_home("ws-1", "Workspace", "/tmp/ws-1", &codex_home);
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let sessions = Mutex::new(HashMap::new());
        let engine_manager = engine::EngineManager::new();

        let page = list_workspace_sessions_core(
            &workspaces,
            &sessions,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            Some(WorkspaceSessionCatalogQuery {
                keyword: Some("needle".to_string()),
                engine: None,
                status: Some("all".to_string()),
                folder_id: None,
                ..Default::default()
            }),
            None,
            Some(10),
        )
        .await
        .expect("list sessions");

        assert_eq!(page.data.len(), 1);
        assert_eq!(page.data[0].session_id, "codex-055");
        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn projection_summary_counts_full_history_beyond_default_scan_window() {
        let base = std::env::temp_dir().join(format!("session-summary-full-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let codex_home = base.join("codex-home");
        for index in 0..60 {
            let timestamp = codex_fixture_timestamp(index);
            write_codex_session_fixture_with_message(
                &codex_home,
                &format!("codex-{index:03}"),
                "/tmp/ws-1",
                &timestamp,
                &timestamp,
                "Fixture session",
            );
        }
        let workspace = workspace_with_codex_home("ws-1", "Workspace", "/tmp/ws-1", &codex_home);
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let engine_manager = engine::EngineManager::new();
        // Isolate the Kimi source from the developer's real ~/.kimi-code home;
        // real sessions under /tmp would otherwise match the /tmp/ws-1 workspace.
        engine_manager
            .set_engine_config(
                engine::EngineType::Kimi,
                engine::EngineConfig {
                    home_dir: Some(base.join("kimi-home").to_string_lossy().to_string()),
                    ..Default::default()
                },
            )
            .await;
        // Same isolation for the Grok source (~/.grok).
        engine_manager
            .set_engine_config(
                engine::EngineType::Grok,
                engine::EngineConfig {
                    home_dir: Some(base.join("grok-home").to_string_lossy().to_string()),
                    ..Default::default()
                },
            )
            .await;

        let summary = get_workspace_session_projection_summary_core(
            &workspaces,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            Some(WorkspaceSessionCatalogQuery {
                keyword: None,
                engine: None,
                status: Some("all".to_string()),
                folder_id: None,
                ..Default::default()
            }),
        )
        .await
        .expect("summary");

        assert_eq!(summary.all_total, 60);
        assert_eq!(summary.filtered_total, 60);
        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn delete_success_metadata_cleanup_removes_global_and_folder_state() {
        let mut metadata = WorkspaceSessionCatalogMetadata {
            archived_at_by_session_id: HashMap::from([("claude:gone".to_string(), 42_i64)]),
            folder_id_by_session_id: HashMap::from([(
                "claude:gone".to_string(),
                "folder-a".to_string(),
            )]),
            ..Default::default()
        };

        metadata.archived_at_by_session_id.remove("claude:gone");
        metadata.folder_id_by_session_id.remove("claude:gone");

        assert!(!metadata
            .archived_at_by_session_id
            .contains_key("claude:gone"));
        assert!(!metadata.folder_id_by_session_id.contains_key("claude:gone"));
    }

    #[test]
    fn keyword_match_includes_source_fields() {
        let entry = catalog_entry("codex:abc", "ws-1", None, None);

        assert!(entry_matches_keyword(&entry, "example"));
        assert!(entry_matches_keyword(&entry, "codex"));
        assert!(entry_matches_keyword(&entry, "cli/codex"));
    }

    #[test]
    fn missing_delete_errors_are_treated_as_settled_success() {
        assert!(should_settle_delete_as_success(
            "[SESSION_NOT_FOUND] Session file not found: stale-session"
        ));
        assert!(should_settle_delete_as_success(
            "thread not found: stale-thread"
        ));
        assert!(!should_settle_delete_as_success(
            "[SESSION_NOT_FOUND] Invalid OpenCode session id"
        ));
        assert!(!should_settle_delete_as_success("permission denied"));
        assert!(!should_settle_delete_as_success("workspace not connected"));
    }

    #[tokio::test]
    async fn orphan_metadata_is_listed_for_cleanup_in_all_scope() {
        let base = std::env::temp_dir().join(format!("session-orphan-list-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let workspace = workspace_entry("ws-1", "Workspace", "/tmp/ws-1", WorkspaceKind::Main, None);
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let sessions = Mutex::new(HashMap::new());
        let engine_manager = engine::EngineManager::new();
        let folder = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-1".to_string(),
            "Stale".to_string(),
            None,
        )
        .await
        .expect("create folder")
        .folder;
        with_catalog_metadata_mutation(&storage_path, "ws-1", |metadata| {
            metadata
                .archived_at_by_session_id
                .insert("codex-missing".to_string(), 42);
            metadata
                .folder_id_by_session_id
                .insert("codex-missing".to_string(), folder.id.clone());
            Ok(())
        })
        .expect("write orphan metadata");

        let page = list_workspace_sessions_core(
            &workspaces,
            &sessions,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            Some(WorkspaceSessionCatalogQuery {
                keyword: None,
                engine: None,
                status: Some("all".to_string()),
                folder_id: None,
                ..Default::default()
            }),
            None,
            Some(20),
        )
        .await
        .expect("list sessions");

        let orphan = page
            .data
            .iter()
            .find(|entry| entry.session_id == "codex-missing")
            .expect("orphan entry");
        assert!(!orphan.exists_on_disk);
        assert_eq!(
            orphan.inconsistency_code.as_deref(),
            Some(SESSION_INCONSISTENCY_MISSING_ON_DISK)
        );
        assert_eq!(
            orphan.delete_mode.as_deref(),
            Some(SESSION_DELETE_MODE_METADATA_CLEANUP)
        );
        assert_eq!(orphan.folder_id.as_deref(), Some(folder.id.as_str()));

        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn delete_missing_session_cleans_orphan_metadata_successfully() {
        let base = std::env::temp_dir().join(format!("session-orphan-delete-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let codex_home = base.join("codex-home");
        let workspace = workspace_with_codex_home("ws-1", "Workspace", "/tmp/ws-1", &codex_home);
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let sessions = Mutex::new(HashMap::new());
        let engine_manager = engine::EngineManager::new();
        let folder = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "ws-1".to_string(),
            "Stale".to_string(),
            None,
        )
        .await
        .expect("create folder")
        .folder;
        with_catalog_metadata_mutation(&storage_path, "ws-1", |metadata| {
            metadata
                .archived_at_by_session_id
                .insert("codex-missing".to_string(), 42);
            metadata
                .folder_id_by_session_id
                .insert("codex-missing".to_string(), folder.id.clone());
            Ok(())
        })
        .expect("write orphan metadata");

        let response = delete_workspace_sessions_core(
            &workspaces,
            &sessions,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            vec!["codex-missing".to_string()],
        )
        .await
        .expect("delete missing session");

        assert_eq!(response.results.len(), 1);
        assert!(response.results[0].ok);
        assert_eq!(
            response.results[0].code.as_deref(),
            Some(SESSION_DELETE_CODE_ALREADY_MISSING_CLEANED)
        );
        assert_eq!(response.results[0].deleted_from_disk, Some(false));
        assert_eq!(response.results[0].metadata_cleaned, Some(true));
        let metadata = read_catalog_metadata(&storage_path, "ws-1").expect("read metadata");
        assert!(!metadata
            .archived_at_by_session_id
            .contains_key("codex-missing"));
        assert!(!metadata
            .folder_id_by_session_id
            .contains_key("codex-missing"));

        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn batch_delete_removes_pi_session_file() {
        let base = std::env::temp_dir().join(format!("session-pi-delete-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");
        let workspace = workspace_with_codex_home(
            "ws-1",
            "Workspace",
            "/tmp/ws-1",
            &base.join("codex-home"),
        );
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let sessions = Mutex::new(HashMap::new());
        let engine_manager = engine::EngineManager::new();
        let pi_home = base.join("pi-agent");
        engine_manager
            .set_engine_config(
                engine::EngineType::Pi,
                engine::EngineConfig {
                    home_dir: Some(pi_home.to_string_lossy().to_string()),
                    ..Default::default()
                },
            )
            .await;
        let session_id = "019fe705-27fd-712e-a1be-f972ef3773f3";
        let session_dir = pi_home.join("sessions").join("--tmp-ws-1--");
        std::fs::create_dir_all(&session_dir).expect("create pi session dir");
        let file = session_dir.join(format!("2026-08-09T14-55-02-653Z_{session_id}.jsonl"));
        let mut handle = std::fs::File::create(&file).expect("create pi session file");
        writeln!(
            handle,
            r#"{{"type":"session","version":3,"id":"{session_id}","timestamp":"2026-08-09T14:55:02.653Z","cwd":"/tmp/ws-1"}}"#
        )
        .unwrap();

        let response = delete_workspace_sessions_core(
            &workspaces,
            &sessions,
            &engine_manager,
            &storage_path,
            "ws-1".to_string(),
            vec![format!("pi:{session_id}")],
        )
        .await
        .expect("delete pi session");

        assert_eq!(response.results.len(), 1);
        assert!(
            response.results[0].ok,
            "pi batch delete must succeed: {:?}",
            response.results[0].error
        );
        assert!(
            !file.exists(),
            "pi session file must be removed from disk"
        );
        std::fs::remove_dir_all(base).ok();
    }
