<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import wordmark from "../brand/assets/wordmark.svg";
import { SituateButton } from "../ui";
import c from "../localization/en.auth-callback.json";
import CallbackHandoff from "./CallbackHandoff.vue";
import CallbackCelebration from "./CallbackCelebration.vue";
import { handoffDuration } from "./score";
import type { CallbackAction, CallbackState } from "./model";

const props = defineProps<{ state: CallbackState }>();
const emit = defineEmits<{ action: [action: CallbackAction] }>();
const copy = computed(() => c.page[props.state.status]);
const helpId = `callback-help-${useId()}`;
const surface = ref<HTMLElement>();
const animationTime = ref(handoffDuration);
let previousTitle = "";
onMounted(() => {
  previousTitle = document.title;
  document.title = `${c.page.documentTitle} · ${c.page.brand}`;
});
onBeforeUnmount(() => {
  document.title = previousTitle;
});
</script>

<template>
  <div ref="surface" class="callback-surface">
    <CallbackCelebration
      v-if="state.status === 'received'"
      :time-ms="animationTime"
    />
    <div class="auth-callback" :data-status="state.status">
      <header class="callback-header">
        <img :src="wordmark" :alt="c.page.brand" width="132" height="35" />
      </header>
      <main class="callback-main" aria-labelledby="callback-title">
        <div v-if="state.status === 'received'" class="callback-art">
          <CallbackHandoff
            :replay="state.replay"
            :paused="state.paused"
            :time-ms="state.timeMs"
            :still="state.still"
            :visibility-target="surface"
            @frame="animationTime = $event"
          />
        </div>
        <div v-else class="callback-art callback-error-art" aria-hidden="true">
          <svg viewBox="0 0 560 430" focusable="false">
            <path
              d="M85 304C48 216 98 100 227 86C361 71 466 155 473 266C479 352 409 383 278 380C164 377 109 361 85 304Z"
              fill="var(--situate-lilac)"
            />
            <g transform="rotate(-7 280 225)">
              <rect
                x="180"
                y="119"
                width="209"
                height="239"
                rx="18"
                fill="var(--situate-line)"
              />
              <path
                d="M171 111H330L379 162V328Q379 345 362 345H188Q171 345 171 328Z"
                fill="var(--situate-surface)"
              />
              <path
                d="M330 111V147Q330 162 345 162H379"
                fill="var(--situate-bend-highlight)"
              />
              <circle cx="275" cy="218" r="34" fill="var(--situate-lilac)" />
              <path
                d="M275 201V221M275 234V235M222 284H327M242 302H307"
                fill="none"
                stroke="var(--situate-ink)"
                stroke-width="5"
                stroke-linecap="round"
              />
            </g>
          </svg>
        </div>
        <section class="callback-copy">
          <p
            v-if="state.status === 'rejected'"
            class="callback-status"
            role="status"
            aria-atomic="true"
          >
            <span class="callback-status-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20" focusable="false">
                <path d="M10 5v6m0 4v.1" />
              </svg>
            </span>
            {{ c.page.rejected.status }}
          </p>
          <h1 id="callback-title">{{ copy.title }}</h1>
          <p class="callback-body">{{ copy.body }}</p>
          <p v-if="state.status === 'rejected'" class="callback-next">
            {{ c.page.rejected.next }}
          </p>
          <SituateButton
            variant="plain"
            class="callback-help"
            :aria-expanded="state.helpOpen"
            :aria-controls="helpId"
            @click="emit('action', { type: 'help', open: !state.helpOpen })"
          >
            {{ c.page.help }}
            <svg
              viewBox="0 0 20 20"
              aria-hidden="true"
              focusable="false"
              :class="{ open: state.helpOpen }"
            >
              <path d="m6 8 4 4 4-4" />
            </svg>
          </SituateButton>
          <div v-show="state.helpOpen" :id="helpId" class="callback-help-body">
            <p>{{ copy.helpBody }}</p>
          </div>
        </section>
      </main>
      <footer v-if="state.status === 'rejected'" class="callback-footer">
        <span aria-hidden="true" class="callback-footer-line" />
        <p>{{ c.page.rejected.close }}</p>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.callback-surface {
  position: relative;
  isolation: isolate;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--situate-paper);
}
.auth-callback {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  background: var(--situate-paper);
  color: var(--situate-ink);
  font-family: var(--situate-font-body);
}
.callback-header {
  position: relative;
  z-index: 2;
  padding: 32px 48px;
}
.callback-header img {
  display: block;
  height: auto;
  background: var(--situate-paper);
  box-shadow: 0 0 0 8px var(--situate-paper);
}
.callback-main {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  align-items: center;
  gap: clamp(24px, 4vw, 64px);
  width: min(1100px, calc(100% - 96px));
  margin: auto;
  padding-block: 24px 48px;
}
.callback-art {
  position: relative;
  z-index: 2;
  min-width: 0;
}
.callback-error-art svg {
  display: block;
  width: 100%;
}
.callback-copy {
  position: relative;
  z-index: 2;
  max-width: 440px;
  min-width: 0;
  background: var(--situate-paper);
  box-shadow: 0 0 0 16px var(--situate-paper);
}
.callback-status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 23px;
  font-size: 13px;
  font-weight: 600;
}
.callback-status-icon {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  border-radius: 50%;
  background: var(--situate-lemon);
}
[data-status="rejected"] .callback-status-icon {
  background: var(--situate-lilac);
}
.callback-status svg,
.callback-help svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
h1 {
  overflow-wrap: anywhere;
  font-family: var(--situate-font-display);
  font-size: clamp(44px, 5.1vw, 64px);
  line-height: 1.06;
  font-weight: var(--situate-weight-display);
  letter-spacing: var(--situate-tracking-section);
  margin: 0 0 22px;
  text-wrap: balance;
}
.callback-body {
  max-width: 36ch;
  font-size: 17px;
  line-height: 1.65;
  margin: 0 0 20px;
}
.callback-next {
  color: var(--situate-muted);
  font-size: 14px;
  line-height: 1.6;
  margin: 0 0 18px;
}
.callback-help {
  max-width: 100%;
  white-space: normal;
  text-align: left;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 46px;
  padding: 0 10px;
  border: 0;
  border-bottom: 1px solid var(--situate-control-line);
  border-radius: 0;
  color: var(--situate-ink);
  background: transparent;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.callback-help:hover {
  color: var(--situate-violet-deep);
}
.callback-help:focus-visible {
  outline: 3px solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
  border-radius: 3px;
}
.callback-help svg.open {
  transform: rotate(180deg);
}
.callback-help-body {
  max-width: 37ch;
  font-size: 14px;
  line-height: 1.6;
  padding: 16px 0 0;
}
.callback-help-body p {
  margin: 0 0 10px;
}
.callback-footer {
  position: relative;
  z-index: 2;
  flex: 0 0 auto;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 14px;
  padding: 24px 24px 32px;
  color: var(--situate-muted);
}
.callback-footer p {
  background: var(--situate-paper);
  box-shadow: 0 0 0 8px var(--situate-paper);
  font-size: 13px;
  line-height: 1.6;
  margin: 0;
}
.callback-footer-line {
  width: 24px;
  height: 1px;
  background: var(--situate-control-line);
}
@media (max-width: 700px) {
  .callback-header {
    padding: 24px;
  }
  .callback-header img {
    width: 112px;
  }
  .callback-main {
    width: min(440px, calc(100% - 48px));
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
    padding-block: 0 24px;
  }
  .callback-art {
    width: min(100%, 350px);
    margin: 0 auto 4px;
  }
  .callback-copy {
    max-width: none;
  }
  .callback-status {
    margin-bottom: 18px;
  }
  h1 {
    font-size: clamp(40px, 8vw, 52px);
    margin-bottom: 18px;
  }
  .callback-body {
    font-size: 16px;
    margin-bottom: 16px;
  }
  .callback-footer {
    padding-bottom: 24px;
    justify-content: flex-start;
  }
}
@media (max-height: 600px) and (min-width: 701px) {
  .callback-header {
    padding-block: 20px;
  }
  .callback-main {
    padding-block: 8px 24px;
  }
  .callback-art {
    max-width: 390px;
    margin-inline: auto;
  }
  h1 {
    font-size: 46px;
  }
}
@media (max-height: 700px) and (max-width: 700px) {
  .callback-art {
    width: min(62%, 230px);
  }
  .callback-header {
    padding-block: 18px;
  }
}
</style>
