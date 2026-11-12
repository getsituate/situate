use super::*;

pub(super) fn save_record(
    storage: &Storage,
    next: &ConversationRecord,
) -> Result<ConversationRecord, SaveFailure> {
    let context = storage
        .read_conversation_context(&next.id)?
        .ok_or("missing-chat".to_owned())?;
    let (old, ids) = persistence::project(&context)?;
    let batch = persistence::Batch::build(&context.metadata, &old, &ids, next);
    let mut metadata = if batch.entries.is_empty() {
        context.metadata
    } else {
        storage.append_conversation_entries(
            &next.id,
            next.revision,
            &batch.entries,
            batch.metadata.selected_entry_id.as_deref(),
        )?
    };
    metadata.title = next.title.clone();
    metadata.title_input = next.title_input.clone();
    metadata.development = next.development.clone();
    if !next.draft.is_empty()
        || next.runtime.as_ref().is_some_and(|runtime| {
            !runtime.draft_attachments.is_empty() || !runtime.draft_references.is_empty()
        })
    {
        let empty = situate_core::conversation_runtime::Runtime::default();
        let runtime = next.runtime.as_ref().unwrap_or(&empty);
        metadata.legacy_draft = Some(
            json!({"text":next.draft,"attachments":runtime.draft_attachments,"references":runtime.draft_references}),
        );
    }
    storage.update_conversation_metadata(&metadata, metadata.revision)?;
    storage
        .read_conversation(&next.id)?
        .ok_or_else(|| "missing-chat".to_owned().into())
}
