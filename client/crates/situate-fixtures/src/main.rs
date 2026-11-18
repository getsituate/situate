use std::path::Path;

fn run(args: &[String]) -> Result<(), String> {
    match args {
        [mode, scenario, parent, name] if mode == "create" => {
            let workspace = situate_fixtures::create(scenario, Path::new(parent), name)?;
            println!("Created {}", workspace.handle);
            Ok(())
        }
        [mode, scenario, target] if mode == "apply" => {
            let draft = situate_fixtures::apply(scenario, Path::new(target))?;
            println!("Added \"{}\" to {target}", draft.title);
            Ok(())
        }
        _ => Err(
            "Usage: situate-fixtures create SCENARIO PARENT NAME | apply ACTION CONFIRMED_PATH"
                .into(),
        ),
    }
}
fn main() -> std::process::ExitCode {
    match run(&std::env::args().skip(1).collect::<Vec<_>>()) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            std::process::ExitCode::FAILURE
        }
    }
}
