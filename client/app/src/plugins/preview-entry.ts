import tokens from "../../../../design/brand/tokens.css?inline";
import styles from "../style.css?inline";
import { startPreviewRenderer, type PreviewBridge } from "./preview-transport";

const style = document.createElement("style");
style.textContent = tokens + styles;
document.head.append(style);
const { __SITUATE_EXECUTOR__: bridge } = globalThis as unknown as {
  __SITUATE_EXECUTOR__: PreviewBridge;
};
startPreviewRenderer(bridge);
