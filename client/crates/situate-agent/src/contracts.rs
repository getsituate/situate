use crate::{SaveFailure, ToolOutcome};
use rig_core::completion::ToolDefinition;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use situate_core::conversation_history::{
    ConversationContext, ConversationMetadata, HistoryEntry, HistoryPage,
};
use situate_core::{attachment::AttachmentRef, conversation_runtime::ContentReference};
use std::future::Future;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub attachments: Vec<AttachmentRef>,
    #[serde(default)]
    pub references: Vec<ContentReference>,
}
impl Input {
    pub(crate) fn validate(&self, allow_empty: bool) -> Result<(), String> {
        if self.text.len() > 1_048_576
            || (!allow_empty
                && self.text.trim().is_empty()
                && self.attachments.is_empty()
                && self.references.is_empty())
        {
            return Err("native.ai.conversation.versionInvalid".into());
        }
        let runtime = situate_core::conversation_runtime::Runtime {
            draft_attachments: self.attachments.clone(),
            draft_references: self.references.clone(),
            ..Default::default()
        };
        runtime.validate(0)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunConfig {
    pub settings: Value,
    pub instructions: Vec<Value>,
    pub context_window: u64,
    pub max_tokens: u64,
    pub generate_title: bool,
    pub generate_comments: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestKind {
    Main,
    Compaction,
    Title,
    Comment,
}

#[derive(Clone, Debug)]
pub struct ModelRequest {
    pub run_id: String,
    pub request_id: String,
    pub kind: RequestKind,
    pub context: Vec<Value>,
    pub definitions: Vec<ToolDefinition>,
    pub config: RunConfig,
}

#[derive(Clone, Debug)]
pub struct ToolRequest {
    pub run_id: String,
    pub id: String,
    pub definition: ToolDefinition,
    pub arguments: Value,
    pub call: Value,
    pub config: RunConfig,
}

#[derive(Clone, Debug)]
pub enum Progress {
    PartialMessage(Value),
    ActivityComment(String),
}

#[derive(Clone)]
pub struct ProgressSink(pub(crate) mpsc::Sender<Progress>);
impl ProgressSink {
    pub fn channel(capacity: usize) -> (Self, mpsc::Receiver<Progress>) {
        let (sender, receiver) = mpsc::channel(capacity);
        (Self(sender), receiver)
    }

    pub async fn send(&self, progress: Progress) -> Result<(), String> {
        self.0
            .send(progress)
            .await
            .map_err(|_| "native.ai.turn.inactive".into())
    }
}

#[derive(Clone, Debug, Default)]
pub struct QuestionOutcome {
    pub question: Option<Value>,
    pub continue_run: bool,
}

/// Host effects must settle their resources before returning. `drain` also joins
/// independently owned work if a model, tool or mutation future panics.
pub trait Host: Send + Sync + 'static {
    fn validate_session(&self) -> Result<(), String>;
    fn now_ms(&self) -> u64;
    fn load(&self) -> impl Future<Output = Result<ConversationContext, String>> + Send;
    fn append(
        &self,
        expected_revision: u64,
        entries: Vec<HistoryEntry>,
        selected_entry_id: Option<String>,
    ) -> impl Future<Output = Result<ConversationMetadata, SaveFailure>> + Send;
    fn update_metadata(
        &self,
        metadata: ConversationMetadata,
        expected_revision: u64,
    ) -> impl Future<Output = Result<ConversationMetadata, SaveFailure>> + Send;
    fn entry(
        &self,
        entry_id: String,
    ) -> impl Future<Output = Result<Option<HistoryEntry>, String>> + Send;
    fn action(
        &self,
        action_id: String,
    ) -> impl Future<Output = Result<Option<HistoryEntry>, String>> + Send;
    fn input_state(
        &self,
        input_id: String,
    ) -> impl Future<Output = Result<Option<String>, String>> + Send;
    fn history(
        &self,
        before: Option<String>,
        limit: usize,
    ) -> impl Future<Output = Result<HistoryPage, String>> + Send;
    /// Check native workspace and attachment authority for newly admitted input.
    /// Accepted action receipts are replayed without repeating this check.
    fn validate_input(&self, _input: &Input) -> impl Future<Output = Result<(), String>> + Send {
        std::future::ready(Ok(()))
    }
    fn definitions(&self) -> Vec<ToolDefinition>;
    fn tool_provenance(&self, definition: &ToolDefinition) -> Value;
    fn plugin_available(
        &self,
        plugin_id: String,
    ) -> impl Future<Output = Result<Value, String>> + Send;
    fn capture(
        &self,
        run_id: String,
        metadata: ConversationMetadata,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<RunConfig, String>> + Send;
    /// Refresh main-request instructions and atomically publish capabilities before returning.
    /// Captured settings, limits and auxiliary flags must remain unchanged; failures must not
    /// publish a partial capability update. This hook is not used for auxiliary requests.
    fn prepare_model(
        &self,
        _config: &mut RunConfig,
        _cancel: CancellationToken,
    ) -> impl Future<Output = Result<(), String>> + Send {
        std::future::ready(Ok(()))
    }
    /// Resolve references against their captured identities and retain attachment
    /// references rather than provider-sized image bytes in the returned user message.
    fn input(
        &self,
        input: Input,
        timestamp: u64,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<Value, String>> + Send;
    /// Hydrate retained attachments and perform target-specific context projection.
    /// Never mutate the supplied portable record or invent original model attribution.
    fn context(
        &self,
        messages: Vec<Value>,
        config: RunConfig,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<Vec<Value>, String>> + Send;
    fn model(
        &self,
        request: ModelRequest,
        progress: ProgressSink,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<Value, String>> + Send;
    fn tool(
        &self,
        request: ToolRequest,
        progress: ProgressSink,
        cancel: CancellationToken,
    ) -> impl Future<Output = ToolOutcome> + Send;
    /// Return true only when authoritative host state makes this retained decision obsolete.
    /// The owner persists supersession before admitting input or retrying a host action.
    fn question_retired(
        &self,
        _question: Value,
    ) -> impl Future<Output = Result<bool, String>> + Send {
        std::future::ready(Ok(false))
    }
    fn question_action(
        &self,
        question: Value,
        response: Value,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<QuestionOutcome, String>> + Send;
    fn drain(
        &self,
        run_id: String,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<(), String>> + Send;
}
