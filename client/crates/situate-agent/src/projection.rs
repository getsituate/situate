use crate::*;

impl<H: Host> Owner<H> {
    pub(crate) fn trim_saved(&self, state: &mut State) {
        let count = state
            .snapshot
            .record
            .runtime
            .as_ref()
            .and_then(|runtime| runtime.checkpoint.as_ref())
            .map_or(0, |checkpoint| checkpoint.source_count);
        if count > 0 {
            state
                .snapshot
                .record
                .messages
                .as_array_mut()
                .unwrap()
                .drain(..count);
            state.snapshot.message_entry_ids.drain(..count);
            state.snapshot.message_offset += count;
            state
                .snapshot
                .record
                .runtime
                .as_mut()
                .unwrap()
                .checkpoint
                .as_mut()
                .unwrap()
                .source_count = 0;
        }
        let pending_question = questions::pending(&state.snapshot.record)
            .and_then(|question| question["id"].as_str().map(str::to_owned));
        let pending_action = questions::action_pending(&state.snapshot.record);
        if let Some(runtime) = &mut state.snapshot.record.runtime {
            runtime.pending.retain(|input| input.state == "pending");
            runtime.events.retain(|event| {
                event.kind != "action_accepted" || event.data["action"]["type"] == "draft"
            });
            for event in &mut runtime.events {
                if event.kind == "input_accepted" {
                    event.data = json!({"inputId":event.run_id});
                }
            }
            if runtime.runs.len() > 2 {
                runtime.runs.drain(..runtime.runs.len() - 2);
            }
            if runtime.events.len() > 256 {
                let active = state
                    .snapshot
                    .action_id
                    .as_deref()
                    .filter(|_| state.snapshot.task_active || state.snapshot.question_busy);
                let runtime = state.snapshot.record.runtime.as_mut().unwrap();
                let cutoff = runtime.events.len() - 256;
                let mut removed = 0;
                let mut index = 0;
                runtime.events.retain(|event| {
                    let keep = index >= cutoff
                        || active == Some(event.run_id.as_str())
                        || (event.kind.starts_with("question_")
                            && event.data[if event.kind == "question_presented" {
                                "id"
                            } else {
                                "questionId"
                            }]
                            .as_str()
                            .is_some_and(|id| {
                                pending_question.as_deref() == Some(id)
                                    || pending_action.as_deref() == Some(id)
                            }));
                    index += 1;
                    if !keep && event.kind != "action_accepted" {
                        removed += 1;
                    }
                    keep
                });
                state.snapshot.event_offset += removed;
            }
        }
        state.snapshot.history_before = state.snapshot.message_entry_ids.first().cloned();
        let retained: std::collections::HashSet<_> = state
            .snapshot
            .message_entry_ids
            .iter()
            .chain(state.active_inputs.iter())
            .cloned()
            .collect();
        state.resolved_inputs.retain(|id, _| retained.contains(id));
        let waiting: std::collections::HashSet<_> = state
            .snapshot
            .record
            .runtime
            .as_ref()
            .into_iter()
            .flat_map(|runtime| runtime.pending.iter())
            .map(|input| input.id.clone())
            .collect();
        state
            .input_entry_ids
            .retain(|input_id, entry_id| waiting.contains(input_id) || retained.contains(entry_id));
        state.saved = state.snapshot.record.clone();
        let mut receipts = self
            .receipts
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if receipts.len() > 256 {
            receipts.clear();
        }
    }
}
