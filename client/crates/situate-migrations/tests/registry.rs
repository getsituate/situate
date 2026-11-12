use situate_migrations::MIGRATIONS;
use std::{fs, path::Path};
fn compact(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}
#[test]
fn files_registry_versions_and_compiled_fixture_tests_are_one_to_one() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut names: Vec<_> = fs::read_dir(root.join("src/migrations"))
        .unwrap()
        .map(Result::unwrap)
        .map(|e| e.file_name().into_string().unwrap())
        .filter(|n| n != "mod.rs")
        .collect();
    names.sort();
    assert_eq!(names.len(), MIGRATIONS.len());
    let registry = compact(&fs::read_to_string(root.join("src/registry.rs")).unwrap());
    let declarations = compact(&fs::read_to_string(root.join("src/migrations/mod.rs")).unwrap());
    let tests = compact(&fs::read_to_string(root.join("tests/migrations.rs")).unwrap());
    assert_eq!(
        registry.matches("MigrationDescriptor::of::<").count(),
        MIGRATIONS.len()
    );
    assert_eq!(
        declarations.matches("pub(crate)mod").count(),
        MIGRATIONS.len()
    );
    for (index, (name, migration)) in names.iter().zip(MIGRATIONS).enumerate() {
        let id = index as u64 + 1;
        assert_eq!(migration.version.0, id);
        let module = name.strip_suffix(".rs").unwrap();
        assert!(module.starts_with(&format!("m{id:04}_")));
        let source = compact(&fs::read_to_string(root.join("src/migrations").join(name)).unwrap());
        assert_eq!(
            source.matches("implcrate::MigrationforMigration{").count(),
            1
        );
        assert!(source.contains(&format!("constVERSION:MigrationId=MigrationId({id});")));
        assert!(registry.contains(&format!(
            "MigrationDescriptor::of::<migrations::{module}::Migration>()"
        )));
        assert!(declarations.contains(&format!("pub(crate)mod{module};")));
        assert!(tests.contains(&format!("#[path=\"migrations/{name}\"]mod{module};")));
        assert!(root.join("tests/migrations").join(name).is_file());
        for state in ["before", "after"] {
            assert!(
                root.join(format!("tests/fixtures/m{id:04}/{state}"))
                    .is_dir()
            );
        }
    }
}
