use crate::*;
use situate_core::conversation_runtime::Checkpoint;

impl<H: Host> Owner<H> {
    pub(crate) async fn bootstrap_context(
        self: &Arc<Self>,
        action: &str,
        config: &RunConfig,
        cancel: &CancellationToken,
    ) -> Result<(), String> {
        let (truncated, mut before, first_kept) = {
            let state = self.state.lock().await;
            (
                state.context_truncated,
                state.snapshot.history_before.clone(),
                state.snapshot.message_entry_ids.first().cloned(),
            )
        };
        if !truncated {
            return Ok(());
        }
        let first_kept = first_kept.ok_or("chat.compactionFailed")?;
        let summary_config = compaction::summary_config(config);
        let mut summary = String::new();
        loop {
            if cancel.is_cancelled() {
                return Err("native.ai.response.stopped".into());
            }
            let page = self.host.history(before.clone(), 128).await?;
            let mut source = Vec::new();
            for entry in page.entries.iter().filter(|entry| entry.kind == "message") {
                if cancel.is_cancelled() {
                    return Err("native.ai.response.stopped".into());
                }
                let message = if let Some(input) = entry.data.get("input") {
                    let id = input["id"]
                        .as_str()
                        .ok_or("native.ai.conversation.versionInvalid")?;
                    if self.host.input_state(id.to_owned()).await?.as_deref() != Some("consumed") {
                        continue;
                    }
                    self.host
                        .input(
                            Input {
                                text: persistence::message_text(&entry.data["message"]),
                                attachments: serde_json::from_value(
                                    input.get("attachments").cloned().unwrap_or(json!([])),
                                )
                                .map_err(|_| "native.ai.conversation.versionInvalid")?,
                                references: serde_json::from_value(
                                    input.get("references").cloned().unwrap_or(json!([])),
                                )
                                .map_err(|_| "native.ai.conversation.versionInvalid")?,
                            },
                            entry.data["message"]["timestamp"]
                                .as_u64()
                                .unwrap_or_default(),
                            cancel.clone(),
                        )
                        .await?
                } else {
                    entry.data["message"].clone()
                };
                if cancel.is_cancelled() {
                    return Err("native.ai.response.stopped".into());
                }
                source.push(message);
            }
            if source.is_empty() {
                let Some(next) = page.next_before else {
                    break;
                };
                if before.as_ref() == Some(&next) {
                    return Err("chat.compactionFailed".into());
                }
                before = Some(next);
                continue;
            }
            let mut chunks = compaction::chunks(&source, &summary_config)?;
            chunks.reverse();
            for chunk in chunks {
                let response = self.request_summary(action, format!("Summary of later segments:\n{summary}\nEarlier segment (precedes that summary):\n{chunk}"), &summary_config, cancel).await?;
                summary = response;
            }
            let Some(next) = page.next_before else {
                break;
            };
            if before.as_ref() == Some(&next) {
                return Err("chat.compactionFailed".into());
            }
            before = Some(next);
        }
        if summary.trim().is_empty() {
            return Err("chat.compactionFailed".into());
        }
        let _ = first_kept;
        self.checkpoint(action, |record| {
            record.runtime.get_or_insert_default().checkpoint = Some(Checkpoint {
                source_count: 0,
                summary,
                run_id: action.into(),
            });
        })
        .await?;
        self.state.lock().await.context_truncated = false;
        Ok(())
    }

    pub(crate) async fn request_summary(
        self: &Arc<Self>,
        action: &str,
        prompt: String,
        config: &RunConfig,
        cancel: &CancellationToken,
    ) -> Result<String, String> {
        let response = self
            .request(
                action,
                RequestKind::Compaction,
                vec![json!({"role":"user","content":prompt,"timestamp":self.host.now_ms()})],
                vec![],
                config,
                cancel,
            )
            .await?;
        if response["stopReason"] != "stop"
            || response["content"]
                .as_array()
                .is_none_or(|blocks| blocks.iter().any(|block| block["type"] == "toolCall"))
        {
            return Err("chat.compactionFailed".into());
        }
        let summary = response["content"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|block| block["type"] == "text")
            .filter_map(|block| block["text"].as_str())
            .collect::<Vec<_>>()
            .join("");
        if summary.trim().is_empty() {
            return Err("chat.compactionFailed".into());
        }
        Ok(summary.trim().into())
    }
}
