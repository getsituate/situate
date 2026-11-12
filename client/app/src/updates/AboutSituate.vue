<script setup lang="ts">
import { onMounted } from "vue";
import { t } from "@situate/localization";
import ReleaseHistoryAccess from "./ReleaseHistoryAccess.vue";
import LicenseNoticesAccess from "./LicenseNoticesAccess.vue";
import { installedVersion, loadInstalledVersion } from "./release-history";
onMounted(() => {
  void loadInstalledVersion();
});
</script>
<template>
  <section class="about-situate">
    <p>
      {{
        installedVersion
          ? t("updates.version", { version: installedVersion })
          : t("releaseHistory.versionUnavailable")
      }}
    </p>
    <div class="about-actions">
      <ReleaseHistoryAccess />
      <LicenseNoticesAccess />
    </div>
  </section>
</template>
<style scoped>
.about-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}
.about-situate > p {
  margin: 0 0 24px;
  color: var(--situate-muted);
  font-variant-numeric: tabular-nums;
}
</style>
