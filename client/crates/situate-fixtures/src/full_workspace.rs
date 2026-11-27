mod documents;
mod plugins;

use crate::FixtureConversations;
use serde_json::json;
use situate_core::{
    ai_storage::Storage,
    content::{ContentStore, OperationOutcome, SaveOutcome, WORKING_METHOD_PATH},
    onboarding::{InstructionBase, OnboardingRecord, OnboardingStorage, Step},
    workspaces::Location,
};
use std::path::Path;

pub(super) fn seed(location: &Location, archive: &Path) -> Result<(), String> {
    let root = Path::new(&location.handle);
    let _lease = situate_migrations::prepare(root).map_err(|error| error.to_string())?;
    let mut files = ContentStore::open(root).map_err(|error| error.to_string())?;
    for path in [
        "Inbox",
        "Projects",
        "Projects/Spring open day",
        "Projects/Spring open day/Volunteers",
        "Reference",
        "Reviews",
    ] {
        let outcome = files
            .create_folder(path)
            .map_err(|error| error.to_string())?;
        if !matches!(outcome, OperationOutcome::Complete { .. }) {
            return Err(format!("Could not finish creating {path}: {outcome:?}"));
        }
    }
    for (path, markdown) in [
        (
            "Inbox/Ideas.md",
            "# Ideas\n\n- A seed swap on the welcome table\n- A short tour of the pollinator beds\n",
        ),
        (
            "Projects/Spring open day/Plan.md",
            "# Spring open day\n\nSaturday, 25 April · 10:00–13:00\n\n- [x] Reserve the garden gate <!-- situate-task-id: null -->\n- [ ] Print the rain plan <!-- situate-task-id: null -->\n- [ ] Ask who can bring a folding table <!-- situate-task-id: null -->\n",
        ),
        (
            "Projects/Spring open day/Rain plan.md",
            "# Rain plan\n\nMove the seed swap under the shelter. Keep the gravel path clear. Cancel guided tours if the paths are slippery.\n",
        ),
        (
            "Projects/Spring open day/Volunteers/Shifts.md",
            "# Volunteer shifts\n\n| Time | Post |\n| --- | --- |\n| 09:30 | Set up the welcome table |\n| 10:00 | Greet visitors at the gate |\n| 12:45 | Pack up signs and tables |\n",
        ),
        (
            "Reference/Watering guide.md",
            "# Watering guide\n\nCheck the soil before watering. Water at the roots, early in the morning.\n",
        ),
        (
            "Reviews/Weekly review.md",
            "# Weekly review\n\nReview open tasks every Friday. Move ideas from the inbox only when they have a next action.\n",
        ),
    ] {
        let outcome = files
            .agent_write(path, None, markdown)
            .map_err(|error| error.to_string())?;
        if !matches!(outcome, SaveOutcome::Saved { .. }) {
            return Err(format!("Could not finish saving {path}: {outcome:?}"));
        }
    }
    let SaveOutcome::Saved { version, .. } = files
        .create_text(WORKING_METHOD_PATH, "# Working method\n\nKeep plans with their project. Put new ideas in the inbox and review open tasks every Friday.\n")
        .map_err(|error| error.to_string())?
    else {
        return Err("Could not finish saving the working method".into());
    };
    OnboardingStorage::open(root, &location.id)?.save(
        None,
        OnboardingRecord {
            step: Step::Complete,
            entered: true,
            proposal: version.text.clone(),
            instruction_revision: Some(version.revision.clone()),
            instruction_base: Some(InstructionBase {
                text: version.text,
                revision: version.revision,
            }),
            ..Default::default()
        },
    )?;
    seed_chats(&Storage::open(root, &location.id)?)?;
    documents::seed(archive).map_err(|error| {
        format!(
            "Could not create document folder {}: {error}",
            archive.display()
        )
    })?;
    plugins::seed(root, archive)
}

fn seed_chats(storage: &Storage) -> Result<(), String> {
    for (index, (title, draft, turns)) in [
        ("Weekly review", "", &[
            ("What should I cover in my Friday review?", "Start with the open day plan. Printing the rain plan and finding a folding table are still open. Then decide whether the seed swap idea needs its own task."),
            ("Leave the seed swap in the inbox for now.", "That keeps the review short: check the two open tasks, then stop."),
        ][..]),
        ("Watering the raised beds", "What about the seedlings by the gate?", &[
            ("Should I water the raised beds tonight?", "Check the soil a few centimetres down. If it is still damp, wait until morning and check again. Water at the roots rather than over the leaves."),
        ][..]),
        ("Spring open day", "Can you shorten the welcome sign?", OPEN_DAY_TURNS),
    ].into_iter().enumerate() {
        let id = uuid::Uuid::new_v4().to_string();
        let mut record = storage.create_conversation(&id, title)?;
        record.draft = draft.into();
        record.messages = json!(turns.iter().flat_map(|(question, answer)| [
            ("user", question), ("assistant", answer),
        ]).enumerate().map(|(offset, (role, text))| {
            let timestamp = 1_776_682_800_000_u64 + index as u64 * 86_400_000 + offset as u64 * 60_000;
            if role == "user" {
                json!({"role": role, "content": text, "timestamp": timestamp})
            } else {
                json!({
                    "role": role, "content": [{"type": "text", "text": text}],
                    "timestamp": timestamp, "stopReason": "stop", "usage": null,
                })
            }
        }).collect::<Vec<_>>());
        storage.save_fixture_conversation(&record, record.revision)?;
    }
    Ok(())
}

const OPEN_DAY_TURNS: &[(&str, &str)] = &[
    (
        "Can you help me plan the spring open day? The gate is booked from ten to one.",
        "Use the gate as the welcome point, with a map and a single sign. Set up at 09:30 so the entrance is clear when visitors arrive. Keep the seed swap close to the shelter in case it rains.",
    ),
    (
        "What should somebody see when they arrive?",
        "On the welcome table: a map, the tour times and an empty tray for seeds. Put the map at the front so people can take a look without waiting to speak to a volunteer.",
    ),
    (
        "How long should the tour be?",
        "Allow 20 minutes. Start with the raised beds, stop by the pollinator patch, then return along the gravel path. Offer a shorter loop that skips the uneven path behind the greenhouse.",
    ),
    (
        "Would eleven and noon work?",
        "Yes, if two volunteers can cover the welcome table while a third leads the tour. Put both times on the sign so visitors who miss the first tour know when to come back.",
    ),
    (
        "How do we run the seed swap without collecting names?",
        "Ask people to write the plant name and harvest year on each envelope. Keep blank envelopes and a pencil on the table. Anyone can take seeds even if they did not bring any.",
    ),
    (
        "We only have one table so far.",
        "Split it into two halves: maps on the left, seeds on the right. A second table helps only if it can sit out of the way, leaving the gate and the path clear.",
    ),
    (
        "What do we do if it rains?",
        "Move the seeds under the shelter and move the welcome sign beside it. Cancel guided tours if the gravel or the timber edging gets slippery. Keep the message at the gate short so nobody has to stand in the rain to read it.",
    ),
    (
        "Draft that message.",
        "**Welcome to the spring open day.** The seed swap is under the shelter. Guided tours are paused while the paths are wet. Ask at the table about the next tour.",
    ),
    (
        "Could we leave out ‘next tour’? We may cancel both.",
        "**Welcome to the spring open day.** The seed swap is under the shelter. There are no guided tours while the paths are wet.",
    ),
    (
        "What should we tell the setup volunteers?",
        "Meet at the gate at 09:30. Bring out the table, check that the paths are clear, then put out the signs and seed trays. Leave ten minutes to walk the tour route before opening.",
    ),
    (
        "What if someone arrives before we open?",
        "Greet them at the gate and let them know the garden opens at ten. Finish moving the tables before letting visitors through.",
    ),
    (
        "Where should we put the watering guide?",
        "Leave the full guide in Reference. Put a short sign at the raised beds with one tip visitors can use: check the soil first, then water at the roots.",
    ),
    (
        "Can you give me a packing list?",
        "- Maps and signs\n- Blank envelopes and pencils\n- Seed trays\n- Clips to hold signs in the wind\n- A bag for damp paper",
    ),
    (
        "What should we do with the seeds left over?",
        "Keep labelled envelopes for the next swap. Put unlabelled seeds in a separate tray so they do not get mixed into the labelled stock.",
    ),
    (
        "Which decisions are still open?",
        "Two practical ones: who can bring a second table, and who will lead each tour. The rain plan is ready to print. Decide whether to run the tours after checking the paths on the day.",
    ),
    (
        "Summarize the plan for Friday's review.",
        "**Saturday, 25 April, 10:00–13:00.** Set up at 09:30. Put the welcome table by the gate and run tours at 11:00 and noon if the paths are safe. Move the seed swap under the shelter in rain. Before Saturday, print the rain plan and ask who can bring a folding table.",
    ),
];
