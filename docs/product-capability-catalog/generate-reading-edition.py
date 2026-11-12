"""Assemble the catalog's Markdown sources without maintaining a second set of content."""

import argparse
from functools import lru_cache
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "Situate-Product-Capability-Catalog.md"
AREAS = ("notes", "task-management", "email", "calendar", "documents", "plugins")
IDS = {
    "notes": [f"N{i:02}" for i in range(1, 11)],
    "task-management": ["A01", "A02", "A03", "A04", "A05", "A07"],
    "email": [f"E{i:02}" for i in range(1, 8)],
    "calendar": [f"K{i:02}" for i in range(1, 8)],
    "documents": [f"D{i:02}" for i in range(1, 9)],
    "plugins": [f"P{i:02}" for i in range(1, 7)],
}
NAVIGATION = (
    "Read the [complete Markdown reading edition](Situate-Product-Capability-Catalog.md) "
    "for all six areas in one file.\n\n"
)
STATUSES = (
    "Supported", "Partially supported", "Not supported at reviewed revision", "Unclear"
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def slug(title):
    return re.sub(r"[^\w\- ]", "", title.lower()).replace(" ", "-")


def headings(text):
    return list(re.finditer(r"^(#{1,6}) (.+)$", text, re.M))


def normalized(text):
    # Only table padding changes when Prettier formats rewritten link destinations.
    text = re.sub(r"^\|[- :|]+\|$", "|table-separator|", text, flags=re.M)
    return "\n".join(
        "|".join(cell.strip() for cell in line.split("|"))
        if line.startswith("|") else line.rstrip()
        for line in text.strip().splitlines()
    )


def assemble(sources):
    sources = dict(sources)
    require(sources["README.md"].count(NAVIGATION) == 1, "Missing reading-edition navigation")
    sources["README.md"] = sources["README.md"].replace(NAVIGATION, "")
    titles = {name: text.splitlines()[0][2:] for name, text in sources.items()}

    def heading_for(name, level, title):
        if name == "README.md":
            # The index uses area names too; keep its anchors distinct from the chapters.
            if level == 3 and title in titles.values():
                return level, f"Index: {title}"
            return level, title
        if level == 1 or re.match(r"[NAEKDP]\d{2} — ", title):
            return level + 1, title
        return level + 1, f"{titles[name]}: {title}"

    mapping = {}
    for name, text in sources.items():
        mapping[(name, "")] = slug(titles[name])
        for heading in headings(text):
            _, title = heading_for(name, len(heading[1]), heading[2])
            mapping[(name, slug(heading[2]))] = slug(title)

    def transform(name, text):
        def link(match):
            target, _, fragment = match[2].partition("#")
            owner = target or name
            href = "#" + mapping[(owner, fragment)] if owner in sources else match[2]
            return f"{match[1]}({href})"

        def heading(match):
            level, title = heading_for(name, len(match[1]), match[2])
            return "#" * level + " " + title

        text = re.sub(r"(\[[^\]]*\])\(([^)]+)\)", link, text)
        return re.sub(r"^(#{1,6}) (.+)$", heading, text, flags=re.M)

    parts = re.split(r"(?=^## )", sources["README.md"], flags=re.M)
    intro = parts[0].strip()
    sections = {part.splitlines()[0][3:]: part.strip() for part in parts[1:]}
    front = ["Functional areas", "How to read the entries"]
    conditions = ["Shared prerequisites and boundaries", "Status and evidence legend", "Product revision and scope"]
    back = ["Open records and scope distinctions", "Area and identifier index", "About this catalog"]
    require(set(front + conditions + back) == set(sections), "Unassigned overview section")
    capabilities, evidence = [], []
    for area in AREAS:
        name = area + ".md"
        text = sources[name]
        found_ids = re.findall(r"^### ([NAEKDP]\d{2}) — ", text, re.M)
        require(found_ids == IDS[area], f"Unexpected capability list: {name}")
        boundary = list(re.finditer(r"^## ", text, re.M))[-1].start()
        require("evidence" in text[boundary:].splitlines()[0].lower(), f"Missing evidence section: {name}")
        capabilities.append(transform(name, text[:boundary]).strip())
        evidence.append(transform(name, text[boundary:]).strip())

    chunks = (
        [transform("README.md", sections[key]) for key in front]
        + capabilities
        + [transform("README.md", sections[key]) for key in conditions]
        + ["## Evidence and open questions"]
        + evidence
        + [transform("README.md", sections[key]) for key in back]
    )
    body = "\n\n".join(chunks)
    body = body.replace(
        "This overview and the six area files are the authoritative sources.",
        "The [source overview](README.md) and the six area files are the authoritative sources.",
    )
    top_headings = [h for h in headings(body) if len(h[1]) == 2]
    toc = "\n".join(f"- [{h[2]}](#{slug(h[2])})" for h in top_headings)
    # Put the benefit-led overview before the short contents list, then the area chapters.
    split = body.index("\n\n## Notes\n")
    body = body[:split] + "\n\n## Contents\n\n" + toc + body[split:]
    title, _, introduction = intro.partition("\n\n")
    notice = (
        "> **Generated reading edition.** Source: [catalog overview](README.md) and "
        + ", ".join(f"[{titles[a + '.md']}]({a}.md)" for a in AREAS)
        + ". [Generation and maintenance](working-framework.md#reading-edition-generation)."
    )
    result = "\n\n".join([title, introduction, notice, body]) + "\n"
    return result, capabilities + evidence, top_headings


@lru_cache(None)
def anchors(path):
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"^```.*?^```\s*$", "", text, flags=re.M | re.S)
    return {slug(h[2]) for h in headings(text)}


def validate_links(path, text, generated):
    refs = dict(re.findall(r"^\[([^\]]+)\]:\s+(\S+)", text, re.M))
    for label in re.findall(r"\[[^\]]+\]\[([^\]]+)\]", text):
        require(label in refs, f"Missing reference definition: {path.name}: {label}")
    hrefs = re.findall(r"\[[^\]]*\]\(([^)]+)\)", text) + list(refs.values())
    count = 0
    for href in hrefs:
        if re.match(r"[a-z]+:", href):
            continue
        target, _, fragment = href.partition("#")
        dest = (path.parent / target).resolve() if target else path
        require(dest == OUTPUT or dest.is_file(), f"Missing file: {path.name}: {href}")
        if fragment:
            if dest.suffix == ".md":
                if dest == OUTPUT:
                    available = {slug(h[2]) for h in headings(generated)}
                else:
                    available = {slug(h[2]) for h in headings(text)} if dest == path else anchors(dest)
                require(fragment in available, f"Missing anchor: {path.name}: {href}")
            else:
                match = re.fullmatch(r"L(\d+)(?:-L(\d+))?", fragment)
                require(match is not None, f"Unknown source anchor: {href}")
                require(0 < int(match[1]) <= int(match[2] or match[1]) <= len(dest.read_text(encoding="utf-8").splitlines()), f"Invalid line range: {href}")
        count += 1
    return count


def verify(result, sources, chunks, toc_headings):
    generated_ids = re.findall(r"^#### ([NAEKDP]\d{2}) — ", result, re.M)
    expected_ids = [ident for area in AREAS for ident in IDS[area]]
    require(generated_ids == expected_ids, "Generated capability list differs")
    all_slugs = [slug(h[2]) for h in headings(result)]
    require(len(all_slugs) == len(set(all_slugs)), "Duplicate generated anchors")
    require(len(re.findall(r"^# ", result, re.M)) == 1, "Expected one document title")
    for chunk in chunks:
        require(normalized(chunk) in normalized(result), "Area content omitted")
    toc = result.split("\n## Contents\n", 1)[1].split("\n## Notes\n", 1)[0]
    require(re.findall(r"\]\(#([^)]*)\)", toc) == [slug(h[2]) for h in toc_headings], "Contents differs from chapters")
    index = sources["README.md"].split("## Area and identifier index\n", 1)[1].split("\n## ", 1)[0]
    require(re.findall(r"\[([NAEKDP]\d{2}) — ", index) == expected_ids, "Index differs from capabilities")
    for area in AREAS:
        text = sources[area + ".md"]
        support = re.findall(r"^(?:- )?(?:\*\*)?Support:(?:\*\*)? (.+)$", text, re.M)
        require(len(support) == len(IDS[area]), f"Missing support status: {area}")
        for value in support:
            require(any(value.replace("**", "").rstrip(".").split(". ")[0] == status for status in STATUSES), f"Invalid status: {value}")
        if area == "documents":
            require(all("Not supported at reviewed revision" in value and "Tentative future target" in value for value in support), "Document target status changed")
    count = validate_links(OUTPUT, result, result)
    for name, text in sources.items():
        count += validate_links(ROOT / name, text, result)
    count += validate_links(ROOT / "working-framework.md", (ROOT / "working-framework.md").read_text(encoding="utf-8"), result)
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check the saved edition without writing it")
    args = parser.parse_args()
    sources = {name: (ROOT / name).read_text(encoding="utf-8") for name in ["README.md", *(a + ".md" for a in AREAS)]}
    result, chunks, toc_headings = assemble(sources)
    if args.check:
        actual = OUTPUT.read_text(encoding="utf-8")
        require(normalized(actual) == normalized(result), "Reading edition is stale; regenerate it")
        result = actual
    links = verify(result, sources, chunks, toc_headings)
    if not args.check:
        OUTPUT.write_text(result, encoding="utf-8")
    print(f"Catalog: 44 capabilities, six areas, {len(toc_headings)} contents entries, {links} local links checked.")
    print("Reading edition matches the sources." if args.check else f"Generated {OUTPUT.name}.")


if __name__ == "__main__":
    main()
