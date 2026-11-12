<script setup lang="ts">
import { setupCopy as c } from "./setup-content";
import type { SetupTransitionFrame } from "./setup-transition";
const props = defineProps<{
  step: number;
  transition?: SetupTransitionFrame;
}>();
const completed = (i: number) =>
  i < props.step ||
  !!(
    props.transition &&
    i === props.transition.from &&
    props.transition.check > 0
  );
const activation = (i: number) =>
  props.transition && i === props.transition.to
    ? props.transition.activation
    : 1;
</script>
<template>
  <nav :aria-label="c.progress" class="setup-steps">
    <ol>
      <li
        v-for="(label, i) in c.steps"
        :key="label"
        :class="{ active: i === step, done: completed(i) }"
        :aria-current="i === step ? 'step' : undefined"
      >
        <span class="number" aria-hidden="true">
          <span
            v-if="i === step && !completed(i)"
            class="badge-fill"
            :style="{
              opacity: activation(i),
              transform: `scale(${0.9 + 0.1 * activation(i)})`,
            }"
          />
          <svg v-if="completed(i)" class="check" viewBox="0 0 24 24">
            <path
              d="m6 12 4 4 8-8"
              pathLength="1"
              :style="{
                strokeDashoffset:
                  transition && i === transition.from
                    ? 1 - transition.check
                    : 0,
              }"
            />
          </svg>
          <span
            v-else
            :style="
              i === step
                ? {
                    color: `color-mix(in srgb, var(--workspace-on-accent, var(--situate-surface)) ${activation(i) * 100}%, var(--situate-muted))`,
                  }
                : undefined
            "
            >{{ i + 1 }}</span
          >
          <svg
            v-if="transition && i === transition.from && transition.sparkle > 0"
            class="sparkles"
            viewBox="0 0 60 60"
            :style="{ opacity: transition.sparkle }"
          >
            <line
              v-for="(angle, index) in [-30, 0, 30, 150, 180, 210]"
              :key="angle"
              :transform="`rotate(${angle} 30 30)`"
              x1="30"
              x2="30"
              :y1="30 - transition.sparkleRadius"
              :y2="27 - transition.sparkleRadius"
              :class="{ warm: index % 2 }"
            />
          </svg>
        </span>
        <span class="step-label" :data-label="label"
          ><span class="step-text"
            >{{ label
            }}<span v-if="completed(i)" class="sr-only">
              · {{ c.done }}</span
            ></span
          ></span
        >
      </li>
    </ol>
  </nav>
</template>
<style scoped>
.setup-steps {
  container: setup-progress / inline-size;
  max-width: 1280px;
  margin: 28px auto 0;
}
ol {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  list-style: none;
  padding: 0;
  margin: 0;
}
li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--situate-muted);
}
.step-label {
  display: grid;
  white-space: nowrap;
}
.step-text,
.step-label::after {
  grid-area: 1 / 1;
}
.step-label::after {
  content: attr(data-label);
  font-weight: 650;
  visibility: hidden;
}
.number {
  position: relative;
  isolation: isolate;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid var(--situate-line);
}
.active {
  color: var(--situate-ink);
  font-weight: 650;
}
.active:not(.done) .number {
  border-color: transparent;
}
.badge-fill {
  position: absolute;
  inset: -1px;
  z-index: -1;
  border-radius: inherit;
  background: var(--workspace-accent, var(--situate-violet-deep));
}
.check {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.check path {
  stroke-dasharray: 1;
}
.sparkles {
  position: absolute;
  width: 60px;
  height: 60px;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  overflow: visible;
  pointer-events: none;
  stroke: var(--situate-violet);
  stroke-width: 2;
  stroke-linecap: round;
}
.sparkles .warm {
  stroke: var(--situate-tangerine);
}
.done .number {
  background: var(--situate-surface);
  color: var(--situate-ink);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@container setup-progress (max-width: 960px) {
  ol {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 16px;
  }
  li {
    flex-direction: column;
    gap: 8px;
  }
  .step-label {
    white-space: normal;
    text-align: center;
    text-wrap: balance;
  }
}
@container setup-progress (max-width: 500px) {
  ol {
    gap: 8px;
  }
  li {
    font-size: 11px;
  }
  .step-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .active .step-label {
    position: static;
    width: auto;
    height: auto;
    overflow: visible;
    clip-path: none;
  }
}
@media (max-width: 500px) {
  .setup-steps {
    margin-top: 18px;
  }
}
</style>
