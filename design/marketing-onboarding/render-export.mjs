import { renderPack } from "./export.mjs";

const [, , date, proofs] = process.argv;
await renderPack(date, proofs === "proofs");
