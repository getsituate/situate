#[cfg(not(any(target_os = "macos", target_os = "linux")))]
compile_error!("situate-dev currently supports macOS and Linux");

mod actions;
mod app;
mod application_logs;
mod inspection;
mod owned;
mod process;
mod publication;
mod release;
mod report;
mod selection;
mod text;
mod theme;
mod ui;
mod version;

use app::App;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyEventKind},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{Terminal, backend::CrosstermBackend};
use std::{
    io::{self, IsTerminal},
    time::{Duration, Instant},
};
use tokio::{
    signal::unix::{SignalKind, signal},
    sync::mpsc,
};

type Screen = Terminal<CrosstermBackend<io::Stdout>>;
struct TerminalGuard;
impl Drop for TerminalGuard {
    fn drop(&mut self) {
        restore();
    }
}
fn restore() {
    let _ = disable_raw_mode();
    let _ = execute!(
        io::stdout(),
        DisableMouseCapture,
        crossterm::style::ResetColor,
        crossterm::style::SetAttribute(crossterm::style::Attribute::Reset),
        LeaveAlternateScreen,
        crossterm::cursor::Show
    );
}

#[tokio::main]
async fn main() -> io::Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if !args.is_empty() {
        if args.len() == 1 && (args[0] == "--help" || args[0] == "-h") {
            println!("{}", text::USAGE);
            return Ok(());
        }
        return Err(io::Error::other(text::USAGE));
    }
    let root = actions::find_root(&std::env::current_dir()?)
        .ok_or_else(|| io::Error::other(text::ROOT_ERROR))?;
    if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
        return Err(io::Error::other(text::TERMINAL_REQUIRED));
    }
    let branch = std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    let mut interrupt = signal(SignalKind::interrupt())?;
    let mut terminate = signal(SignalKind::terminate())?;
    let mut hangup = signal(SignalKind::hangup())?;
    let original_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        restore();
        original_hook(info);
    }));
    let guard = TerminalGuard;
    enable_raw_mode()?;
    execute!(io::stdout(), EnterAlternateScreen, EnableMouseCapture)?;
    let mut terminal = Terminal::new(CrosstermBackend::new(io::stdout()))?;
    terminal.clear()?;
    let (tx, mut rx) = mpsc::channel(128);
    let mut app = App::new(root, branch, tx);
    let mut ui = ui::Ui::default();
    let result = async {
        let mut refresh = tokio::time::interval(Duration::from_millis(33));
        refresh.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        while !app.quitting {
            tokio::select! {
                _ = interrupt.recv() => app.stop_all(),
                _ = terminate.recv() => app.stop_all(),
                _ = hangup.recv() => app.stop_all(),
                event = rx.recv() => if let Some(event) = event { app.event(event); },
                _ = refresh.tick() => {
                    app.poll_application_logs();
                    for _ in 0..32 {
                        if !event::poll(Duration::ZERO)? { break; }
                        let changed = match event::read()? {
                            Event::Key(key) if key.kind == KeyEventKind::Press => { ui.key(key, &mut app); true }
                            Event::Mouse(mouse) => ui.mouse(mouse, &mut app),
                            Event::Resize(_, _) => true,
                            _ => false,
                        };
                        if changed { terminal.draw(|frame| ui.render(frame, &mut app))?; }
                    }
                    terminal.draw(|frame| ui.render(frame, &mut app))?;
                }
            }
        }
        Ok::<_, io::Error>(())
    }
    .await;
    shutdown(&mut app, &mut rx, &mut terminal, &mut ui).await;
    let root = app.root.clone();
    let handoff = result.and_then(|()| app.prepare_inspection());
    drop(app);
    drop(terminal);
    drop(guard);
    if let Some(directory) = handoff? {
        inspection::launch(&root, &directory)?;
    }
    Ok(())
}

async fn shutdown(
    app: &mut App,
    rx: &mut mpsc::Receiver<process::Event>,
    terminal: &mut Screen,
    ui: &mut ui::Ui,
) {
    app.stop_all();
    let deadline = Instant::now() + Duration::from_secs(9);
    let mut refresh = tokio::time::interval(Duration::from_millis(50));
    refresh.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    while app.active() && Instant::now() < deadline {
        tokio::select! {
            event = rx.recv() => if let Some(event) = event { app.event(event); },
            _ = refresh.tick() => { let _ = terminal.draw(|frame| ui.render(frame, app)); }
        }
    }
    app.join().await;
}
