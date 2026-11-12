use crate::app::Status;
use ratatui::style::{Color, Modifier, Style};
use std::sync::OnceLock;

#[derive(Clone, Copy)]
pub struct Theme {
    pub base: Style,
    pub surface: Style,
    pub header: Style,
    pub border: Style,
    pub focus: Style,
    pub muted: Style,
    pub selected: Style,
    pub button: Style,
    pub accent: Style,
}
impl Theme {
    pub fn new(color: bool) -> Self {
        let plain = Style::default();
        let bold = plain.add_modifier(Modifier::BOLD);
        if !color {
            return Self {
                base: plain,
                surface: plain,
                header: bold,
                border: plain,
                focus: bold,
                muted: plain,
                selected: plain.add_modifier(Modifier::REVERSED),
                button: bold,
                accent: bold,
            };
        }
        let base = plain.fg(token("ink")).bg(token("paper"));
        Self {
            base,
            surface: base.bg(token("surface")),
            header: bold.fg(token("surface")).bg(token("violet-deep")),
            border: base.fg(token("control-line")),
            focus: bold.fg(token("cobalt")).bg(token("surface")),
            muted: base.fg(token("muted")),
            selected: bold.fg(token("surface")).bg(token("violet-deep")),
            button: base.bg(token("lilac")).add_modifier(Modifier::BOLD),
            accent: base.fg(token("violet-deep")).add_modifier(Modifier::BOLD),
        }
    }
    pub fn status(self, status: Status) -> Style {
        match status {
            Status::Running | Status::Stopping => self.focus,
            Status::Passed => self.accent,
            Status::Failed => self
                .base
                .add_modifier(Modifier::BOLD | Modifier::UNDERLINED),
            Status::Cancelled | Status::NoTests => self.muted,
        }
    }
}
fn token(name: &str) -> Color {
    static TOKENS: OnceLock<serde_json::Value> = OnceLock::new();
    let tokens = TOKENS.get_or_init(|| {
        serde_json::from_str(include_str!("../../../design/brand/tokens.json"))
            .expect("valid brand tokens")
    });
    let value = tokens["colors"][name].as_str().expect("brand color");
    let rgb = u32::from_str_radix(value.trim_start_matches('#'), 16).expect("hex brand color");
    Color::Rgb((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn colors_come_from_the_brand_catalog() {
        let theme = Theme::new(true);
        assert_eq!(theme.base.fg, Some(token("ink")));
        assert_eq!(theme.header.bg, Some(token("violet-deep")));
        assert_eq!(theme.selected.fg, Some(token("surface")));
    }
    #[test]
    fn monochrome_retains_selection_and_status_emphasis() {
        let theme = Theme::new(false);
        for style in [
            theme.base,
            theme.header,
            theme.selected,
            theme.status(Status::Failed),
        ] {
            assert!(style.fg.is_none() && style.bg.is_none());
        }
        assert!(theme.selected.add_modifier.contains(Modifier::REVERSED));
        assert!(
            theme
                .status(Status::Failed)
                .add_modifier
                .contains(Modifier::UNDERLINED)
        );
    }
}
