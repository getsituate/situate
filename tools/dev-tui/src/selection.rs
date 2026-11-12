use ratatui::{buffer::Buffer, style::Style, text::Line};
use std::{
    io::{self, Write},
    process::{Command, Stdio},
};

pub struct Selection {
    pub buffer: Buffer,
    anchor: (u16, u16),
    end: (u16, u16),
    pub dragging: bool,
    pub moved: bool,
}
impl Selection {
    pub fn new(buffer: Buffer, x: u16, y: u16) -> Self {
        Self {
            buffer,
            anchor: (y, x),
            end: (y, x),
            dragging: true,
            moved: false,
        }
    }
    pub fn extend(&mut self, x: u16, y: u16) {
        let area = self.buffer.area;
        self.end = (
            y.clamp(area.y, area.bottom() - 1),
            x.clamp(area.x, area.right() - 1),
        );
        self.moved |= self.end != self.anchor;
    }
    fn selected(&self, x: u16, y: u16, width: u16) -> bool {
        let start = self.anchor.min(self.end);
        let end = self.anchor.max(self.end);
        (y, x) <= end && (y, x.saturating_add(width.saturating_sub(1))) >= start
    }
    pub fn text(&self) -> String {
        if !self.moved {
            return String::new();
        }
        let mut lines = Vec::new();
        for y in self.anchor.0.min(self.end.0)..=self.anchor.0.max(self.end.0) {
            let mut line = String::new();
            let mut x = self.buffer.area.x;
            while x < self.buffer.area.right() {
                let symbol = self.buffer[(x, y)].symbol();
                let width = (Line::from(symbol).width() as u16).max(1);
                if self.selected(x, y, width) {
                    line.push_str(symbol);
                }
                x += width;
            }
            lines.push(line.trim_end().to_string());
        }
        lines.join("\n")
    }
    pub fn paint(&self, target: &mut Buffer, style: Style) {
        target.merge(&self.buffer);
        if !self.moved {
            return;
        }
        for y in self.buffer.area.y..self.buffer.area.bottom() {
            let mut x = self.buffer.area.x;
            while x < self.buffer.area.right() {
                let width = (Line::from(self.buffer[(x, y)].symbol()).width() as u16).max(1);
                if self.selected(x, y, width) {
                    for column in x..x.saturating_add(width).min(self.buffer.area.right()) {
                        target[(column, y)].set_style(style);
                    }
                }
                x += width;
            }
        }
    }
}

pub fn copy(text: &str) -> io::Result<()> {
    if !cfg!(target_os = "macos") {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "clipboard unavailable",
        ));
    }
    write_clipboard(Command::new("/usr/bin/pbcopy"), text)
}
fn write_clipboard(mut command: Command, text: &str) -> io::Result<()> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let result = child
        .stdin
        .take()
        .expect("piped stdin")
        .write_all(text.as_bytes());
    let status = child.wait()?;
    result?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other("clipboard command failed"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selection_is_direction_independent_and_excludes_wide_character_padding() {
        let buffer = Buffer::with_lines(["a界e\u{301}z", "second"]);
        let mut selection = Selection::new(buffer, 1, 0);
        selection.extend(2, 1);
        assert_eq!(selection.text(), "界e\u{301}z\nsec");
        let mut reverse = Selection::new(selection.buffer.clone(), 2, 1);
        reverse.extend(1, 0);
        assert_eq!(reverse.text(), selection.text());
        selection.extend(500, 500);
        assert_eq!(selection.text(), "界e\u{301}z\nsecond");
    }
    #[test]
    fn clipboard_receives_exact_text_and_reports_failure() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clipboard");
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "cat > \"$1\"", "clipboard"]).arg(&path);
        write_clipboard(command, "selected 界\ntext").unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "selected 界\ntext");
        assert!(write_clipboard(Command::new("/usr/bin/false"), "text").is_err());
    }
}
