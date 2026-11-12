import { catalogs } from "./index";
import en from "./catalogs/en.assignment-changes.json" with { type: "json" };
import de from "./catalogs/de.assignment-changes.json" with { type: "json" };

// Inspection copy loads with its view rather than the application entry point.
Object.assign(catalogs.en, en);
Object.assign(catalogs.de, de);
