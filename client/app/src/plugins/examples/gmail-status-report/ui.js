import { accountSettings } from "./account-settings.js";

export default (host) => ({
  settings: {
    id: "gmail-status-report:settings",
    title: () => "Gmail status report settings",
    icon: "chat",
    component: accountSettings(host),
  },
});
