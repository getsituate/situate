import catalog from "virtual:catalog";
import { renderMarkdown, resolveDocumentLink } from "./markdown.js";
import DOMPurify from "dompurify";
import { filterEntries } from "./filter.js";
import "./style.css";
import {
  implementationSummary,
  milestoneNames,
  milestoneScope,
} from "./delivery.js";
import { deliveryText as copy } from "./content.js";

const app = document.querySelector("#app");
const entries = catalog.entries;
const labels = {
  goal: "Goal",
  requirement: "Requirement",
  approved: "Approved",
  rejected: "Rejected",
  must: "Must",
  should: "Should",
  could: "Could",
};
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const entryLink = (id) => `#entry/${encodeURIComponent(id)}`;
let collectionHash = "#";
const milestoneLink = (name) => `#milestones?name=${encodeURIComponent(name)}`;
const milestoneNav = document.createElement("a");
milestoneNav.href = "#milestones";
milestoneNav.textContent = copy.milestones;
document.querySelector("nav").append(milestoneNav);

function progress(criteria) {
  const summary = implementationSummary(criteria);
  return `${escape(copy[summary.status])}${summary.total ? ` · ${escape(copy.count(summary.implemented, summary.total))}` : ""}`;
}

function criteriaTable(criteria) {
  return `<div class="criteria-table" tabindex="0" role="region" aria-label="${escape(copy.acceptanceCriteria)}"><table><thead><tr><th scope="col">ID</th><th scope="col">${copy.criterion}</th><th scope="col">${copy.milestone}</th><th scope="col">${copy.implementation}</th></tr></thead><tbody>${criteria.map((criterion) => `<tr><th scope="row">${escape(criterion.id)}</th><td>${escape(criterion.text)}</td><td><a href="${milestoneLink(criterion.milestone || "")}">${escape(criterion.milestone || copy.unplanned)}</a></td><td>${escape(copy[criterion.status])}</td></tr>`).join("")}</tbody></table></div>`;
}

function delivery(entry) {
  if (entry.type !== "requirement") return "";
  const names = milestoneNames([entry]);
  return `<section class="delivery"><h2>${copy.overall}</h2><p>${progress(entry.acceptanceCriteria)}</p>${names.length ? `<h3>${copy.milestones}</h3><ul>${names.map((name) => `<li><a href="${milestoneLink(name)}">${escape(name)}</a>: ${progress(milestoneScope([entry], name)[0].criteria)}</li>`).join("")}</ul>` : ""}${entry.acceptanceCriteria ? `<h2 id="section-acceptance-criteria">${copy.acceptanceCriteria}</h2>${criteriaTable(entry.acceptanceCriteria)}` : ""}</section>`;
}

function renderMilestones(query) {
  const params = new URLSearchParams(query);
  document.title = `${copy.milestones} · Situate`;
  if (!params.has("name")) {
    const names = milestoneNames(entries);
    const groups = [
      ...names,
      ...(milestoneScope(entries, "").length ? [""] : []),
    ];
    app.innerHTML = `<h1>${copy.milestones}</h1><p>${copy.trackedOnly}</p>${!names.length ? `<div class="empty"><h2>${copy.empty}</h2><p>${copy.emptyHelp}</p></div>` : ""}${groups.map((name) => `<article class="card"><h2><a href="${milestoneLink(name)}">${escape(name || copy.unplanned)}</a></h2><p>${progress(milestoneScope(entries, name).flatMap((group) => group.criteria))}</p></article>`).join("")}`;
    return;
  }
  const name = params.get("name");
  const groups = milestoneScope(entries, name);
  document.title = `${name || copy.unplanned} · Situate`;
  app.innerHTML = `<a class="back" href="#milestones">${copy.back}</a><h1>${escape(name || copy.unplanned)}</h1><p>${copy.trackedOnly}</p>${groups.length ? `<p>${copy.scope}: ${progress(groups.flatMap((group) => group.criteria))}</p>${groups.map(({ entry, criteria }) => `<article class="card"><h2><a href="${entryLink(entry.id)}">${escape(entry.id)} · ${escape(entry.title)}</a></h2><div>${badges(entry)}</div><p>${copy.overall}: ${progress(entry.acceptanceCriteria)}</p><p>${copy.scope}: ${progress(criteria)}</p>${criteriaTable(criteria)}</article>`).join("")}` : `<div class="empty"><h2>${name ? copy.missing : copy.unplannedEmpty}</h2><p>${copy.missingHelp}</p></div>`}`;
}

function markdown(body, file = "foundations.md") {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = DOMPurify.sanitize(renderMarkdown(body), {
    FORBID_TAGS: ["img", "input", "form", "style"],
    FORBID_ATTR: ["style"],
  });
  for (const anchor of wrapper.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) {
      anchor.rel = "noopener noreferrer";
      continue;
    }
    let target;
    try {
      target = resolveDocumentLink(href, file);
    } catch {
      anchor.removeAttribute("href");
      continue;
    }
    if (!target) continue;
    const entry = entries.find((item) => item.file === target.file);
    const route = entry
      ? entryLink(entry.id)
      : target.file === "foundations.md"
        ? "#foundations"
        : null;
    if (route)
      anchor.setAttribute(
        "href",
        route +
          (target.section
            ? `?section=${encodeURIComponent(target.section)}`
            : ""),
      );
    else anchor.removeAttribute("href");
  }
  return wrapper.innerHTML;
}

function badges(entry) {
  return `<span class="badge">${labels[entry.type]}</span><span class="badge ${entry.status}">${labels[entry.status]}</span>${entry.priority ? `<span class="badge">${labels[entry.priority]}</span>` : ""}`;
}

function renderCollection() {
  collectionHash = location.hash || "#";
  document.title = "Situate · Requirements";
  const filters = Object.fromEntries(
    new URLSearchParams(location.hash.replace(/^#\??/, "")),
  );
  const select = (name, title, values) =>
    `<label>${title}<select name="${name}" aria-label="${title}"><option value="">All</option>${values.map((value) => `<option value="${escape(value)}" ${filters[name] === value ? "selected" : ""}>${escape(labels[value] || value)}</option>`).join("")}</select></label>`;
  app.innerHTML = `<section class="intro"><p class="eyebrow">Goals & Requirements</p><h1>What Situate should do.</h1><p>Understand needs. Clarify requirements. Record decisions.</p></section>
    <form class="filters" role="search"><label class="search">Search<input name="q" type="search" placeholder="Title, ID or content" value="${escape(filters.q || "")}"></label>
    ${select("type", "Entry type", ["goal", "requirement"])}${select("area", "Area", [...new Set(entries.map((entry) => entry.area))].sort())}${select("status", "Status", ["approved", "rejected"])}${select("priority", "Priority", ["must", "should", "could"])}<button type="reset">Reset</button></form>
    <p id="count" class="count" role="status"></p><section id="results" aria-label="Entries"></section>`;
  const form = app.querySelector("form");
  const update = () => {
    const state = Object.fromEntries(new FormData(form));
    const query = new URLSearchParams(
      Object.entries(state).filter(([, value]) => value),
    );
    collectionHash = query.size ? `#?${query}` : "#";
    history.replaceState(null, "", collectionHash);
    const matches = filterEntries(entries, state);
    app.querySelector("#count").textContent =
      `${matches.length} of ${entries.length} entries`;
    app.querySelector("#results").innerHTML = matches.length
      ? matches
          .map(
            (entry) =>
              `<article class="card"><div class="card-meta"><span>${escape(entry.id)} · ${escape(entry.area)}</span><div>${badges(entry)}</div></div><h2><a href="${entryLink(entry.id)}">${escape(entry.title)}</a></h2>${entry.type === "requirement" ? `<p>${progress(entry.acceptanceCriteria)}</p>` : ""}${entry.goals?.length ? `<p class="goal-links">Goals: ${entry.goals.map((id) => `<a href="${entryLink(id)}">${escape(id)}</a>`).join(", ")}</p>` : ""}</article>`,
          )
          .join("")
      : `<div class="empty"><h2>${entries.length ? "No matching entries" : "No goals or requirements yet"}</h2><p>${entries.length ? "Adjust the search or filters." : "Goals and requirements will appear here once they are added."}</p></div>`;
  };
  form.addEventListener("input", update);
  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("reset", (event) => {
    event.preventDefault();
    for (const control of form.querySelectorAll("input, select"))
      control.value = "";
    update();
  });
  update();
}

function render() {
  const [hash, query = ""] = location.hash.split("?");
  if (hash === "#milestones") {
    renderMilestones(query);
  } else if (hash === "#foundations") {
    document.title = "Foundations · Situate";
    app.innerHTML = `<a class="back" href="${escape(collectionHash)}">← Collection</a><article class="document">${markdown(catalog.foundations)}</article>`;
  } else if (hash.startsWith("#entry/")) {
    let id;
    try {
      id = decodeURIComponent(hash.slice(7));
    } catch {
      id = "";
    }
    const entry = entries.find((item) => item.id === id);
    if (!entry) {
      document.title = "Entry not found · Situate";
      app.innerHTML =
        '<h1>Entry not found</h1><p>This link does not point to an existing entry.</p><a href="#">Back to collection</a>';
    } else {
      document.title = `${entry.id} · ${entry.title} · Situate`;
      const related =
        entry.type === "requirement"
          ? entries.filter((item) => entry.goals.includes(item.id))
          : entries.filter((item) => item.goals?.includes(entry.id));
      app.innerHTML = `<a class="back" href="${escape(collectionHash)}">← Collection</a><article class="document"><p class="eyebrow">${escape(entry.id)} · ${escape(entry.area)}</p><h1>${escape(entry.title)}</h1><div class="badges">${badges(entry)}</div>${related.length ? `<aside><h2>${entry.type === "goal" ? "Requirements for this goal" : "Related goals"}</h2><ul>${related.map((item) => `<li><a href="${entryLink(item.id)}">${escape(item.id)} · ${escape(item.title)}</a></li>`).join("")}</ul></aside>` : ""}<div class="prose">${markdown(entry.body, entry.file)}</div>${delivery(entry)}<footer>Source file: <code>data/${escape(entry.file)}</code></footer></article>`;
    }
  } else renderCollection();
  const section = new URLSearchParams(query).get("section");
  const heading = section
    ? document.getElementById(`section-${section}`)
    : null;
  if (heading) heading.scrollIntoView();
  else window.scrollTo(0, 0);
}
window.addEventListener("hashchange", () => {
  render();
  const heading = app.querySelector("h1");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
});
render();
