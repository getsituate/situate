import { createApp, h } from "vue";
import SituateScrollbars from "./ui/SituateScrollbars.vue";
import "./brand/tokens.css";
import "./style.css";

const preview =
  new URLSearchParams(location.search).get("workshop") === "preview";
const { default: component } = preview
  ? await import("./workshop/Preview.vue")
  : await import("./workshop/Controls.vue");
createApp({
  render: () => h(SituateScrollbars, null, { default: () => h(component) }),
}).mount("#app");
