import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const quote = (value) => JSON.stringify(value);

export function validateAction(action) {
  assert(
    action && Object.keys(action).length === 1,
    "Invalid native accessibility action",
  );
  if (action.windows !== undefined) {
    assert(
      Number.isInteger(action.windows) &&
        action.windows > 0 &&
        action.windows <= 4,
      "Invalid owned window count",
    );
  } else if (action.folderField !== undefined) {
    assert(
      action.folderField === true ||
        (typeof action.folderField === "string" &&
          action.folderField.length <= 4096),
      "Invalid folder picker assertion",
    );
  } else if (action.key) {
    assert(
      ["return", "down", "a", "g", "w"].includes(action.key.key) &&
        Array.isArray(action.key.modifiers) &&
        action.key.modifiers.every((value) =>
          ["command", "shift"].includes(value),
        ),
      "Invalid accessibility key chord",
    );
  } else if (
    action.click ||
    action.assert ||
    action.focus ||
    action.navigation ||
    action.replaceText
  ) {
    const target =
      action.click ??
      action.assert ??
      action.focus ??
      action.navigation ??
      action.replaceText;
    if (action.replaceText)
      assert(
        target.role === "AXTextArea" &&
          target.window &&
          typeof target.value === "string" &&
          target.value.length <= 16384,
        "Invalid synthetic editor replacement",
      );
    if (action.navigation)
      assert(
        ["AXButton", "AXPopUpButton"].includes(target.role) &&
          target.window &&
          target.name !== "Open navigation" &&
          target.value === undefined,
        "Invalid workspace navigation target",
      );
    assert(
      [
        "AXButton",
        "AXMenuItem",
        "AXPopUpButton",
        "AXComboBox",
        "AXStaticText",
        "AXTextField",
        "AXCheckBox",
        "AXTextArea",
      ].includes(target.role) &&
        typeof target.name === "string" &&
        target.name.length > 0 &&
        (target.window === undefined ||
          (typeof target.window === "string" && target.window.length > 0)) &&
        (target.value === undefined || typeof target.value === "string"),
      "Invalid accessibility target",
    );
  } else if (action.type !== undefined) {
    assert(
      typeof action.type === "string" && action.type.length <= 16384,
      "Invalid synthetic text input",
    );
  } else throw new Error("Unsupported native accessibility action");
}

export function accessibilityScript(pid, action) {
  assert(Number.isSafeInteger(pid) && pid > 1, "Invalid owned application PID");
  validateAction(action);
  const prefix = `tell application "System Events"\nset targetProcess to first application process whose unix id is ${pid}\ntell targetProcess\nset frontmost to true\n`;
  if (action.type !== undefined)
    return `${prefix}keystroke ${quote(action.type)}\nend tell\nend tell`;
  if (action.windows !== undefined)
    return `${prefix}if count of windows is not ${action.windows} then error "Owned window count differs"\nend tell\nend tell`;
  if (action.folderField !== undefined) {
    const checkValue =
      action.folderField === true
        ? ""
        : `\nif value of field is not ${quote(action.folderField)} then error "Folder path differs"`;
    return `${prefix}if count of (windows whose subrole is "AXDialog") is not 1 then error "Owned window must be unique"\nset field to value of attribute "AXFocusedUIElement"\nif role of field is not "AXTextField" then error "Folder field is not focused"${checkValue}\nend tell\nend tell`;
  }
  if (action.key) {
    const code = { return: 36, down: 125 }[action.key.key];
    const modifiers = action.key.modifiers.length
      ? ` using {${action.key.modifiers.map((value) => `${value} down`).join(", ")}}`
      : "";
    return `${prefix}${code ? `key code ${code}` : `keystroke ${quote(action.key.key)}`}${modifiers}\nend tell\nend tell`;
  }
  const target =
    action.click ??
    action.assert ??
    action.focus ??
    action.navigation ??
    action.replaceText;
  const selectWindow = target.window
    ? `set ownedWindows to windows whose name is ${quote(target.window)}\n${action.navigation ? 'if count of ownedWindows is 0 then return "pending"\n' : ""}if count of ownedWindows is not 1 then error "Owned window must be unique"\nset ownedWindow to item 1 of ownedWindows\n${action.focus ? 'perform action "AXRaise" of ownedWindow\n' : ""}`
    : "";
  const folderButton =
    target.role === "AXButton" && target.name === "Open" && !target.window;
  if (folderButton)
    return `${prefix}set panels to windows whose subrole is "AXDialog"\nif count of panels is not 1 then error "Owned window must be unique"\nset targets to my openPanelButtons(item 1 of panels, 0)\nif count of targets is not 1 then error "Accessibility target must be unique"\nset confirmation to item 1 of targets\nif enabled of confirmation is not true then error "Accessibility control is disabled"\n${action.click ? 'perform action "AXPress" of confirmation\n' : ""}end tell\nend tell\non openPanelButtons(parentRef, depth)\nif depth > 7 then return {}\nset matches to {}\ntell application "System Events"\nset children to UI elements of parentRef\nif (count of children) > 64 then error "Folder panel exceeds accessibility bounds"\nrepeat with childRef in children\nset child to contents of childRef\nset childRole to role of child\nif childRole is "AXButton" then\nif name of child is "Open" or title of child is "Open" then set end of matches to child\nelse if childRole is in {"AXGroup", "AXSplitGroup", "AXSheet"} then\nset matches to matches & my openPanelButtons(child, depth + 1)\nend if\nend repeat\nend tell\nreturn matches\nend openPanelButtons`;
  const enumerate =
    target.role === "AXMenuItem" && !target.window
      ? "set entries to entire contents\n"
      : target.window
        ? "set entries to entire contents of ownedWindow\n"
        : "set entries to {}\nrepeat with windowRef in windows\nset entries to entries & (entire contents of (contents of windowRef))\nend repeat\n";
  const label = quote(target.name);
  if (action.navigation)
    return `${prefix}${selectWindow}${enumerate}set targetCount to 0
set openers to {}
repeat with elementRef in entries
try
set candidate to contents of elementRef
set candidateRole to role of candidate
if candidateRole is ${quote(target.role)} and (name of candidate is ${label} or description of candidate is ${label}) then
set targetCount to targetCount + 1
else if candidateRole is "AXButton" and (name of candidate is "Open navigation" or description of candidate is "Open navigation") then
set end of openers to candidate
end if
end try
end repeat
if targetCount > 1 then error "Workspace navigation target must be unique"
if targetCount is 1 then return "visible"
if count of openers > 1 then error "Workspace navigation opener must be unique"
if count of openers is 0 then return "pending"
if not enabled of item 1 of openers then return "pending"
return "reveal"
end tell
end tell`;
  return `${prefix}${selectWindow}${enumerate}set matches to {}\nrepeat with elementRef in entries\ntry\nset candidate to contents of elementRef\nif role of candidate is ${quote(target.role)} and (name of candidate is ${label} or description of candidate is ${label}) then set end of matches to candidate\nend try\nend repeat\nif count of matches is not 1 then error ("Accessibility target must be unique: " & (count of matches))\n${["AXButton", "AXPopUpButton", "AXComboBox"].includes(target.role) ? 'if not enabled of item 1 of matches then error "Accessibility control is disabled"\n' : ""}${action.click ? 'perform action "AXPress" of item 1 of matches' : action.focus ? 'set value of attribute "AXFocused" of item 1 of matches to true' : action.replaceText ? `set value of attribute "AXValue" of item 1 of matches to ${quote(target.value)}` : target.value !== undefined ? `if value of item 1 of matches is not ${quote(target.value)} then error "Accessibility value differs"` : 'if not (exists item 1 of matches) then error "Accessibility assertion failed"'}\nend tell\nend tell`;
}

export function accessibilityFailureCode(error) {
  const raw = error?.cause?.message;
  if (typeof raw !== "string") return "ax_unavailable";
  const message = raw.trimEnd();
  const count = /Accessibility target must be unique: (\d+) \(-2700\)$/.exec(
    message,
  );
  if (count)
    return count[1] === "0" ? "ax_target_missing" : "ax_target_ambiguous";
  if (message.endsWith("Workspace navigation target must be unique (-2700)"))
    return "ax_target_ambiguous";
  if (message.endsWith("Accessibility control is disabled (-2700)"))
    return "ax_target_disabled";
  if (message.endsWith("Owned window must be unique (-2700)"))
    return "ax_window_unavailable";
  if (message.endsWith("Accessibility value differs (-2700)"))
    return "ax_value_mismatch";
  return "ax_unavailable";
}

export async function checkAccessibilityAction(
  pid,
  action,
  { execute, options, pending = () => {} },
) {
  const script = accessibilityScript(pid, action);
  if (action.navigation) {
    const state = await execute("osascript", ["-e", script], options);
    if (state === "pending") {
      pending({ accessibilityObservation: "ax_target_missing" });
      return false;
    }
    if (state === "visible") return true;
    assert.equal(state, "reveal", "Workspace navigation state is unknown");
    const opener = {
      role: "AXButton",
      name: "Open navigation",
      window: action.navigation.window,
    };
    await execute(
      "osascript",
      ["-e", accessibilityScript(pid, { click: opener })],
      options,
    );
    return true;
  }
  const target = action.assert;
  // System Events can omit static text that WebKit exposes through native AX.
  if (
    target?.role === "AXStaticText" &&
    target.window &&
    target.value === undefined
  ) {
    const result = await execute(
      "/usr/bin/swift",
      [
        fileURLToPath(
          new URL("./qualification-ax-text.swift", import.meta.url),
        ),
        String(pid),
        target.name,
        target.window,
      ],
      options,
    );
    if (result === "matched") return true;
    assert(
      result === "unmatched" || result === "temporarily-unavailable",
      "Native text observation unavailable",
    );
    pending({
      accessibilityObservation:
        result === "unmatched" ? "ax_target_missing" : "ax_unavailable",
    });
    return false;
  }
  try {
    await execute("osascript", ["-e", script], options);
    return true;
  } catch (error) {
    if (
      ["timeout", "cancelled"].includes(error.qualificationStatus) ||
      (!action.assert &&
        action.windows === undefined &&
        action.folderField === undefined)
    )
      throw error;
    pending(error);
    return false;
  }
}
