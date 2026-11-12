import { catalogs } from "./index";
import en from "./catalogs/en.plugin-management.json" with { type: "json" };
import de from "./catalogs/de.plugin-management.json" with { type: "json" };

Object.assign(catalogs.en, en);
Object.assign(catalogs.de, de);
