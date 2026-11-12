use crate::conversation_runtime::ContentReference;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum LocalReference {
    Live {
        path: String,
        #[serde(rename = "anchorRevision")]
        anchor_revision: String,
    },
    Historical {
        path: String,
        revision: String,
    },
}

impl LocalReference {
    pub(crate) fn bind(self, scope: &str) -> Result<ContentReference, ()> {
        let reference = match self {
            Self::Live {
                path,
                anchor_revision,
            } => ContentReference::Live {
                workspace_id: scope.into(),
                path,
                anchor_revision,
            },
            Self::Historical { path, revision } => ContentReference::Historical {
                workspace_id: scope.into(),
                path,
                revision,
            },
        };
        if !reference.validate() {
            return Err(());
        }
        Ok(reference)
    }

    pub(crate) fn store(reference: ContentReference, scope: &str) -> Result<Self, ()> {
        if !reference.validate() || reference.workspace_id() != scope {
            return Err(());
        }
        Ok(match reference {
            ContentReference::Live {
                path,
                anchor_revision,
                ..
            } => Self::Live {
                path,
                anchor_revision,
            },
            ContentReference::Historical { path, revision, .. } => {
                Self::Historical { path, revision }
            }
        })
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Projection {
    Store,
    Bind,
}

impl Projection {
    fn reference(self, value: &mut Value, scope: &str) -> Result<(), ()> {
        *value = match self {
            Self::Bind => {
                let local: LocalReference =
                    serde_json::from_value(value.clone()).map_err(|_| ())?;
                serde_json::to_value(local.bind(scope)?).map_err(|_| ())?
            }
            Self::Store => {
                let reference = serde_json::from_value(value.clone()).map_err(|_| ())?;
                serde_json::to_value(LocalReference::store(reference, scope)?).map_err(|_| ())?
            }
        };
        Ok(())
    }

    pub(crate) fn layout(self, data: &mut Value, scope: &str) -> Result<(), ()> {
        let layout = data.get_mut("layout").ok_or(())?;
        if let Some(tabs) = layout.get_mut("tabs") {
            for tab in tabs.as_array_mut().ok_or(())? {
                self.tab(tab, scope)?;
            }
        }
        if let Some(closed) = layout.get_mut("closedTabs") {
            for entry in closed.as_array_mut().ok_or(())? {
                self.tab(entry.get_mut("tab").ok_or(())?, scope)?;
            }
        }
        Ok(())
    }

    fn tab(self, tab: &mut Value, scope: &str) -> Result<(), ()> {
        let panes = tab.get_mut("panes").ok_or(())?;
        for pane in panes.as_array_mut().ok_or(())? {
            let entries = pane.pointer_mut("/navigation/entries").ok_or(())?;
            for entry in entries.as_array_mut().ok_or(())? {
                entry.as_object().ok_or(())?;
                if entry.pointer("/target/kind").and_then(Value::as_str) != Some("view")
                    || entry.pointer("/target/viewId").and_then(Value::as_str) != Some("files")
                {
                    continue;
                }
                if let Some(reference) = entry.pointer_mut("/presentation/reference")
                    && !reference.is_null()
                {
                    self.reference(reference, scope)?;
                }
            }
        }
        Ok(())
    }
}
