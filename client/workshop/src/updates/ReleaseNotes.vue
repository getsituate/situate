<script setup lang="ts">
import { computed, reactive, useId } from "vue";
import copy from "../localization/en.updates.json" with { type: "json" };
import panesImage from "./assets/workspace-panes.png";
import documentsImage from "./assets/document-filters.png";
import type { ReleaseContent } from "./release-history";
const props = withDefaults(defineProps<{ release?: ReleaseContent }>(), {
  release: "latest",
});
const article = computed(() =>
  props.release === "latest"
    ? copy.featureNotes
    : copy.releaseArchive[props.release],
);
const prefix = useId();
const images: Record<string, string> = {
  panes: panesImage,
  documents: documentsImage,
};
const failedImages = reactive(new Set<string>());
</script>

<template>
  <article class="release-long" :aria-labelledby="`${prefix}-release-title`">
    <header class="release-lead">
      <h4 :id="`${prefix}-release-title`">{{ article.title }}</h4>
      <p class="release-deck">{{ article.intro }}</p>
    </header>
    <section
      v-for="(section, index) in article.sections"
      :key="section.title"
      class="feature-story"
      :aria-labelledby="`${prefix}-feature-${index}`"
    >
      <h5 :id="`${prefix}-feature-${index}`">
        {{ section.title }}
      </h5>
      <p v-for="paragraph in section.paragraphs" :key="paragraph">
        {{ paragraph }}
      </p>
      <figure v-if="section.image">
        <img
          v-if="!failedImages.has(section.image)"
          :src="images[section.image]"
          :alt="section.imageAlt"
          width="1200"
          height="720"
          loading="lazy"
          @error="failedImages.add(section.image)"
        />
        <p v-else class="image-unavailable">
          {{ article.imageUnavailable }}
        </p>
        <figcaption>{{ section.imageCaption }}</figcaption>
      </figure>
      <p class="release-subheading">
        <strong>{{ section.subheading }}</strong>
      </p>
      <p v-for="paragraph in section.details" :key="paragraph">
        {{ paragraph }}
      </p>
    </section>
  </article>
</template>

<style scoped>
.release-long {
  max-width: 680px;
  margin-inline: auto;
  padding: 8px 0 24px;
}
.release-lead {
  margin-bottom: 32px;
}
.release-lead h4 {
  font-size: 24px;
  line-height: 1.2;
  max-width: 24ch;
  margin: 0 0 20px;
  text-wrap: balance;
}
.release-deck {
  margin: 0;
  font-size: 16px;
  line-height: 1.65;
  color: var(--situate-muted);
  max-width: 65ch;
}
.feature-story {
  padding-bottom: 36px;
  margin-bottom: 36px;
  border-bottom: 1px solid var(--situate-line);
}
.feature-story:last-child {
  margin-bottom: 0;
  border-bottom: 0;
  padding-bottom: 0;
}
.feature-story h5 {
  scroll-margin-top: 20px;
  font-size: 18px;
  line-height: 1.4;
  margin: 0 0 20px;
  text-wrap: balance;
}
.feature-story .release-subheading {
  font-size: 16px;
  margin: 28px 0 14px;
  line-height: 1.45;
}
.feature-story > p {
  max-width: 68ch;
  margin: 0 0 18px;
  font-size: 16px;
  line-height: 1.8;
  color: var(--situate-ink);
}
.feature-story figure {
  margin: 28px 0;
}
.feature-story img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 14px;
  border: 1px solid var(--situate-line);
  box-sizing: border-box;
  background: var(--situate-paper);
}
figcaption {
  max-width: 65ch;
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--situate-muted);
}
.image-unavailable {
  margin: 0;
  padding: 24px;
  border: 1px solid var(--situate-line);
  border-radius: 14px;
  color: var(--situate-muted);
  font-size: 14px;
}
@media (max-width: 600px) {
  .release-deck {
    font-size: 16px;
  }
  .feature-story h5 {
    font-size: 18px;
  }
  .feature-story > p {
    font-size: 15px;
    line-height: 1.8;
  }
  .feature-story img {
    border-radius: 10px;
  }
}
</style>
