# JavaScript recipes

These examples assume browser JavaScript and existing elements. They illustrate one mechanism at a time; they do not supply application semantics, asset creation, or a complete accessibility layer. Use the lifecycle contract below for every recipe. Verify library examples against the installed version. The examples are not browser-performance benchmarks.

## Shared lifecycle contract

- Update application state independently of decorative playback.
- Evaluate `matchMedia("(prefers-reduced-motion: reduce)")` before starting motion and subscribe to `change` for in-flight motion.
- When motion is reduced, apply the intended readable state, not an arbitrary paused frame.
- Return a cleanup function from component setup. Cancel owned effects, unsubscribe listeners, and dispose owned resources.
- For a continuous loop or heavy renderer, stop offscreen/hidden work and reset the time origin before resuming.
- Maintain explicit property ownership. An example that owns `transform` must use a dedicated wrapper if another effect also needs transforms.

## 1. Native keyframes with mid-flight retargeting

Use this for a decorative horizontal marker whose semantic state is represented by the surrounding controls. The element must be connected, have no CSS transform transition, and have no other transform owner. Positions are CSS pixels. WAAPI timing is in milliseconds.

The final inline style is applied before the effect begins. Cancelling the effect therefore reveals the intended final state rather than resetting the interface. Retargeting samples the current visual transform first. This preserves position, not spring velocity.

```js
function createMarkerMotion(element) {
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  let active = null;
  let disposed = false;

  function settle() {
    active?.cancel();
    active = null;
  }

  function moveTo(x) {
    if (disposed || !Number.isFinite(x)) return;
    const from = getComputedStyle(element).transform;
    settle();
    const to = `translateX(${x}px)`;
    element.style.transform = to;

    if (preference.matches || typeof element.animate !== "function") return;
    const animation = element.animate(
      [{ transform: from }, { transform: to }],
      { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    active = animation;
    animation.onfinish = () => {
      if (active === animation) {
        active = null;
        animation.cancel();
      }
    };
  }

  function onPreferenceChange() {
    if (preference.matches) settle();
  }
  preference.addEventListener("change", onPreferenceChange);

  return {
    moveTo,
    destroy() {
      disposed = true;
      settle();
      preference.removeEventListener("change", onPreferenceChange);
    },
  };
}
```

Use `moveTo` after updating the selected control's real state. Call `destroy` on unmount. No `finished` promise is used here; if a sequence awaits that promise, handle the expected `AbortError` on cancellation without swallowing unrelated errors.

Source: [Element.animate](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate).

## 2. Retargetable spring value with Motion

This uses the full `motion` package, not `motion/mini`. A numeric motion value owns a decorative wrapper's horizontal transform. Keeping the same motion value allows the animation system to track velocity between updates. Duration options in Motion use seconds; this example specifies physical parameters instead.

```js
import { animate, motionValue } from "motion";

function createSpringMarker(element) {
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  const x = motionValue(0);
  let target = 0;
  let disposed = false;
  let playback = null;
  const render = (value) => {
    element.style.transform = `translateX(${value}px)`;
  };
  const unsubscribe = x.on("change", render);
  render(0);

  function moveTo(next) {
    if (disposed || !Number.isFinite(next)) return;
    target = next;
    if (preference.matches) {
      x.jump(target);
    } else {
      playback = animate(x, target, {
        type: "spring",
        stiffness: 260,
        damping: 28,
        mass: 1,
      });
    }
  }

  function onPreferenceChange() {
    if (preference.matches) x.jump(target);
  }
  preference.addEventListener("change", onPreferenceChange);

  return {
    moveTo,
    destroy() {
      disposed = true;
      playback?.stop();
      x.jump(target);
      unsubscribe();
      preference.removeEventListener("change", onPreferenceChange);
    },
  };
}
```

The parameter values are a tuning starting point. Test retargeting during both acceleration and settling with the installed Motion version. Do not replace the motion value on every update, or velocity continuity is lost.

Sources: [Motion animate](https://motion.dev/docs/animate), [motion values](https://motion.dev/docs/motion-value), [spring values](https://motion.dev/docs/spring-value).

## 3. SVG stroke drawing without hiding the result

Assume an SVG path that already has a visible stroke and no fill. This pattern owns its dash properties. The completed stroke remains the base state, including without animation support. A drawing effect is not a morph.

```js
function drawStroke(path, reducedMotion) {
  const length = path.getTotalLength();
  path.style.strokeDasharray = `${length} ${length}`;
  path.style.strokeDashoffset = "0";
  if (reducedMotion || length <= 0 || typeof path.animate !== "function") {
    return null;
  }
  return path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
    duration: 320,
    easing: "ease-out",
  });
}
```

Pass the current preference; retain the returned animation and cancel it on a preference change or teardown. Cancel the previous drawing before replaying. A confirmation icon should accompany real status text, not replace it. For an SVG containing multiple paths, choose a meaningful order instead of giving every stroke an identical delay.

Sources: [SVG stroke-dashoffset](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/stroke-dashoffset), [Element.animate](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate).

## 4. Layout change with GSAP Flip

Assume GSAP and its Flip plugin are already approved dependencies. `commitLayout` must synchronously update DOM/CSS, and `targets` must resolve the intended stable elements. This function illustrates the measurement order; it is not a framework state-update wrapper.

```js
import { gsap } from "gsap";
import { Flip } from "gsap/Flip";

gsap.registerPlugin(Flip);

function transitionLayout(targets, commitLayout, reducedMotion) {
  if (reducedMotion) {
    commitLayout();
    return null;
  }
  const before = Flip.getState(targets);
  commitLayout();
  return Flip.from(before, {
    duration: 0.3,
    ease: "power2.out",
    scale: true,
  });
}
```

The caller must retain the returned timeline and define repeat/interrupt behavior. On reduction of motion, settle the active transition to the committed layout before releasing its temporary styles; simply killing an inverted transform can leave an incorrect visual state. For teardown, use the installed GSAP version's context/revert lifecycle and remove component-owned temporary styles. Test nested transforms and resizing. Omit `scale: true` if its visual distortion is worse than the measured cost of the alternative.

For React, capture the first state before the state update and perform the final measurement after the DOM commit. Do not pass an asynchronous state setter as `commitLayout` and assume it has updated the DOM.

Source: [GSAP Flip](https://gsap.com/docs/v3/Plugins/Flip/).

## 5. Compose beats on one timeline

This illustrative Motion sequence uses existing decorative `body` and `accent` elements supplied to the function, not the document body. The small scale anticipation, lift, and secondary settle intentionally overlap. Both elements must already have their correct resting opacity and transform; the caller owns cancellation and preference-change behavior.

```js
import { animate } from "motion";

function playAccent(body, accent, reducedMotion) {
  if (reducedMotion) return null;
  return animate([
    [body, { scale: [1, 0.97, 1] }, { duration: 0.24 }],
    [body, { y: [0, -6, 0] }, { at: 0.06, duration: 0.32 }],
    [accent, { opacity: [0, 1, 0] }, { at: 0.2, duration: 0.24 }],
  ]);
}
```

Do not delay the actual operation until this decorative sequence completes. On cancellation, restore the resting properties the caller owns; stopping a library animation can preserve an intermediate value. A success message stays in ordinary HTML regardless of whether this accent plays. Replace these generic poses with shapes and timing that fit the motion brief.

Source: [Motion sequences](https://motion.dev/docs/animate).

## When these recipes are not enough

- **Rive/Lottie:** obtain an authorized asset, inspect its actual exported names/segments, then integrate its runtime. A made-up `.riv` or JSON URL is not a working example. Verify load errors, state changes, resizing, cleanup, and a static fallback.
- **Particles:** start with analytic trajectories and a finite emission budget. Add collision simulation only when collisions are visible and meaningful.
- **Shaders:** first prove the visual needs a GPU effect. JavaScript uniform updates alone do not constitute a working shader; include the material, vertex/fragment programs, renderer lifecycle, and fallback when implementing one.
- **Morphs:** inspect source and target topology before choosing a library. Two attractive endpoints are insufficient to establish a good transformation.

## Verification cases

Run these in a rendered integration, not just a syntax checker:

1. Trigger once, then repeat rapidly while the effect is moving.
2. Reverse the target mid-flight; inspect position and velocity continuity.
3. Enable reduced motion before load and during playback.
4. Resize, change content, and background/resume the page.
5. Unmount during motion, remount, and check for duplicated listeners or loops.
6. Exercise keyboard and touch alternatives; confirm semantic state never waits for decoration.
7. Profile a representative device with surrounding UI and real assets loaded.
