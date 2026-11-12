import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { inspectMarkdown, resolveDocumentLink } from "../src/markdown.js";

import { implementationStates } from "../src/delivery.js";

export const statuses = ["approved", "rejected"];
export const priorities = ["must", "should", "could"];

async function markdownFiles(directory) {
  const files = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    files.map(async (file) => {
      const full = path.join(directory, file.name);
      if (file.isDirectory()) return markdownFiles(full);
      return file.name.endsWith(".md") ? [full] : [];
    }),
  );
  return nested.flat().sort();
}

export function parseEntry(source, filename) {
  const match = source.match(
    /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/,
  );
  if (!match) throw new Error(`${filename}: YAML metadata is missing.`);
  const metadata = parse(match[1], { uniqueKeys: true });
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`${filename}: Metadata must be an object.`);
  }
  return { ...metadata, body: match[2].trim(), file: filename };
}

export function validateEntries(entries) {
  const errors = [];
  const ids = new Map();
  for (const entry of entries) {
    const fail = (message) => errors.push(`${entry.file}: ${message}`);
    for (const field of ["id", "type", "title", "status", "area"]) {
      if (typeof entry[field] !== "string" || !entry[field].trim())
        fail(`${field} is missing or is not text.`);
    }
    const pattern = entry.type === "goal" ? /^GOAL-\d{4}$/ : /^REQ-\d{4}$/;
    if (!["goal", "requirement"].includes(entry.type))
      fail("type must be goal or requirement.");
    if (typeof entry.id !== "string" || !pattern.test(entry.id))
      fail("Invalid ID (expected GOAL-0001 or REQ-0001).");
    if (ids.has(entry.id)) fail(`Duplicate ID: ${entry.id}.`);
    ids.set(entry.id, entry);
    if (!statuses.includes(entry.status)) fail("Invalid status.");
    if (entry.type === "goal" && ("goals" in entry || "priority" in entry)) {
      fail("goals and priority are only allowed for requirements.");
    }
    if ("acceptanceCriteria" in entry) {
      if (entry.type !== "requirement")
        fail("acceptanceCriteria is only allowed for requirements.");
      if (
        !Array.isArray(entry.acceptanceCriteria) ||
        !entry.acceptanceCriteria.length
      ) {
        fail("acceptanceCriteria must be a non-empty list.");
      } else {
        const criterionIds = new Set();
        for (const criterion of entry.acceptanceCriteria) {
          if (
            !criterion ||
            typeof criterion !== "object" ||
            Array.isArray(criterion)
          ) {
            fail("Each acceptance criterion must be an object.");
            continue;
          }
          if (
            Object.keys(criterion).some(
              (key) => !["id", "text", "status", "milestone"].includes(key),
            )
          )
            fail("Unknown acceptance criterion field.");
          if (
            typeof criterion.id !== "string" ||
            !/^AC-\d{2,}$/.test(criterion.id)
          )
            fail("Invalid acceptance criterion ID (expected AC-01).");
          if (criterionIds.has(criterion.id))
            fail(`Duplicate acceptance criterion ID: ${criterion.id}.`);
          criterionIds.add(criterion.id);
          if (typeof criterion.text !== "string" || !criterion.text.trim())
            fail("Acceptance criterion text must not be empty.");
          if (!implementationStates.includes(criterion.status))
            fail("Invalid acceptance criterion status.");
          if (
            "milestone" in criterion &&
            (typeof criterion.milestone !== "string" ||
              !criterion.milestone.trim() ||
              criterion.milestone !== criterion.milestone.trim() ||
              /[\r\n]/.test(criterion.milestone))
          )
            fail("Milestone must be a non-empty, trimmed single-line name.");
        }
      }
      if (
        inspectMarkdown(entry.body || "").headings.includes(
          "acceptance-criteria",
        )
      )
        fail(
          "Structured acceptanceCriteria replaces the Markdown Acceptance criteria section.",
        );
    }
    if (entry.type === "requirement") {
      if (!priorities.includes(entry.priority)) fail("Invalid priority.");
      if (
        !Array.isArray(entry.goals) ||
        !entry.goals.length ||
        entry.goals.some((id) => typeof id !== "string")
      ) {
        fail("goals must contain at least one goal ID.");
      }
    }
  }
  for (const entry of entries) {
    if (entry.type !== "requirement" || !Array.isArray(entry.goals)) continue;
    for (const id of entry.goals) {
      if (ids.get(id)?.type !== "goal")
        errors.push(`${entry.file}: Unknown goal ${id}.`);
    }
  }
  return errors;
}

export async function loadCatalog(dataDirectory) {
  const entries = [];
  for (const type of ["goals", "requirements"]) {
    for (const file of await markdownFiles(path.join(dataDirectory, type))) {
      const entry = parseEntry(
        await readFile(file, "utf8"),
        path.relative(dataDirectory, file),
      );
      const expected = type === "goals" ? "goal" : "requirement";
      if (entry.type !== expected)
        throw new Error(`${entry.file}: Wrong entry type for this folder.`);
      entries.push(entry);
    }
  }
  const errors = validateEntries(entries);
  if (errors.length) throw new Error(errors.join("\n"));
  const foundations = await readFile(
    path.join(dataDirectory, "foundations.md"),
    "utf8",
  );
  const documents = new Map(
    [...entries, { file: "foundations.md", body: foundations }].map((entry) => [
      entry.file,
      inspectMarkdown(
        entry.body +
          (entry.acceptanceCriteria ? "\n\n## Acceptance criteria\n" : ""),
      ),
    ]),
  );
  for (const [file, document] of documents) {
    for (const href of document.links) {
      let target;
      try {
        target = resolveDocumentLink(href, file);
      } catch {
        errors.push(`${file}: Invalid link ${href}.`);
        continue;
      }
      if (!target) continue;
      const destination = documents.get(target.file);
      if (!destination) errors.push(`${file}: Unknown link target ${href}.`);
      else if (
        target.section &&
        !destination.headings.includes(target.section)
      ) {
        errors.push(`${file}: Unknown section ${href}.`);
      }
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    entries: entries.sort((a, b) => a.id.localeCompare(b.id)),
    foundations,
  };
}
