(function (root) {
  "use strict";
  const names = Object.freeze([
    "hello",
    "consider",
    "gather",
    "celebrate",
    "point",
  ]);
  const controllers = new WeakMap();
  const identity = "translate(0px, 0px) rotate(0deg)";
  const sequence = (transforms, offsets) =>
    transforms.map((transform, index) => ({
      transform,
      offset: offsets[index],
    }));

  function create(svgElement) {
    if (
      !svgElement ||
      svgElement.namespaceURI !== "http://www.w3.org/2000/svg" ||
      svgElement.localName !== "svg" ||
      !svgElement.querySelector('[data-bend-part="figure"]')
    ) {
      throw new TypeError("Expected an SVG returned by SituateBend.render.");
    }
    if (controllers.has(svgElement)) controllers.get(svgElement).destroy();
    const doc = svgElement.ownerDocument;
    const win = doc.defaultView;
    const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
    const figure = svgElement.querySelector('[data-bend-part="figure"]');
    const face = svgElement.querySelector('[data-bend-part="face"]');
    const rightArm = svgElement.querySelector('[data-bend-part="right-arm"]');
    const pose = svgElement.getAttribute("data-bend-pose");
    let paused = false;
    let destroyed = false;
    let observer = null;
    let listening = false;
    let offscreen = false;
    let current = null;

    function visible() {
      const rect = svgElement.getBoundingClientRect();
      return (
        svgElement.isConnected &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < win.innerHeight &&
        rect.right > 0 &&
        rect.left < win.innerWidth
      );
    }
    function detach() {
      if (observer) observer.disconnect();
      observer = null;
      if (!listening) return;
      doc.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", sync);
      win.removeEventListener("scroll", onViewport, true);
      win.removeEventListener("resize", onViewport);
      listening = false;
    }
    function finish(status) {
      const previous = current;
      current = null;
      if (previous) {
        previous.animations.forEach((animation) => animation.cancel());
        previous.resolve(Object.freeze({ name: previous.name, status }));
      }
      detach();
    }
    function sync() {
      if (!current) return;
      if (reduced.matches) {
        finish("reduced-motion");
        return;
      }
      const suspend = paused || doc.hidden || offscreen;
      current.animations.forEach((animation) => {
        if (suspend) animation.pause();
        else if (animation.playState === "paused") animation.play();
      });
    }
    function onViewport() {
      offscreen = !visible();
      sync();
    }
    function attach() {
      offscreen = !visible();
      listening = true;
      doc.addEventListener("visibilitychange", sync);
      reduced.addEventListener("change", sync);
      win.addEventListener("scroll", onViewport, true);
      win.addEventListener("resize", onViewport);
      if (win.IntersectionObserver) {
        observer = new win.IntersectionObserver((entries) => {
          offscreen = !entries[entries.length - 1].isIntersecting || !visible();
          sync();
        });
        observer.observe(svgElement);
      }
    }
    function tracks(name) {
      const figures = {
        hello: [
          identity,
          "translate(0px, -3px) rotate(-2deg)",
          "translate(0px, -2px) rotate(1deg)",
          identity,
        ],
        consider: [
          identity,
          "translate(0px, 2px) rotate(2deg)",
          "translate(0px, 2px) rotate(2deg)",
          identity,
        ],
        gather: [
          identity,
          "translate(0px, 3px) rotate(-3deg)",
          "translate(0px, -3px) rotate(1deg)",
          identity,
        ],
        celebrate: [
          identity,
          "translate(0px, 3px) rotate(-2deg)",
          "translate(0px, -8px) rotate(2deg)",
          identity,
        ],
        point: [
          identity,
          "translate(2px, 0px) rotate(2deg)",
          "translate(2px, 0px) rotate(2deg)",
          identity,
        ],
      };
      const durations = {
        hello: 1400,
        consider: 1600,
        gather: 1300,
        celebrate: 1100,
        point: 1000,
      };
      const result = [
        {
          element: figure,
          frames: sequence(figures[name], [0, 0.25, 0.65, 1]),
          duration: durations[name],
        },
      ];
      // Props and gripping hands share the figure transform; rotating a gripping arm alone would break contact.
      if (name === "hello" && pose === "wave")
        result.push({
          element: rightArm,
          frames: sequence(
            [
              "rotate(0deg)",
              "rotate(-18deg)",
              "rotate(12deg)",
              "rotate(-12deg)",
              "rotate(0deg)",
            ],
            [0, 0.25, 0.5, 0.75, 1],
          ),
          duration: 1400,
        });
      if (name === "point" && pose === "point")
        result.push({
          element: rightArm,
          frames: sequence(
            ["rotate(0deg)", "rotate(-5deg)", "rotate(-5deg)", "rotate(0deg)"],
            [0, 0.25, 0.65, 1],
          ),
          duration: 1000,
        });
      if (name === "consider")
        result.push({
          element: face,
          frames: sequence(
            [
              "translateX(0px)",
              "translateX(-1px)",
              "translateX(-1px)",
              "translateX(0px)",
            ],
            [0, 0.25, 0.65, 1],
          ),
          duration: 1600,
        });
      return result;
    }
    const controller = Object.freeze({
      play(name) {
        if (destroyed)
          throw new Error("This Bend motion controller has been destroyed.");
        if (!names.includes(name)) throw new RangeError("Unknown Bend motion.");
        finish("replaced");
        if (reduced.matches)
          return Promise.resolve(
            Object.freeze({ name, status: "reduced-motion" }),
          );
        if (typeof figure.animate !== "function")
          return Promise.resolve(
            Object.freeze({ name, status: "unsupported" }),
          );
        let resolve;
        const promise = new Promise((done) => {
          resolve = done;
        });
        const entry = { name, resolve, animations: [] };
        current = entry;
        attach();
        try {
          tracks(name).forEach((track) => {
            const animation = track.element.animate(track.frames, {
              duration: track.duration,
              iterations: 1,
              fill: "none",
              easing: "cubic-bezier(.22,.7,.25,1)",
            });
            entry.animations.push(animation);
          });
          Promise.all(
            entry.animations.map((animation) => animation.finished),
          ).then(
            () => {
              if (current === entry) finish("finished");
            },
            () => {
              if (current === entry) finish("stopped");
            },
          );
          sync();
        } catch {
          entry.animations.forEach((animation) =>
            animation.finished.catch(() => {}),
          );
          finish("unsupported");
        }
        return promise;
      },
      pause() {
        if (!destroyed) {
          paused = true;
          sync();
        }
      },
      resume() {
        if (!destroyed) {
          paused = false;
          onViewport();
        }
      },
      stop() {
        finish("stopped");
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        finish("destroyed");
        if (controllers.get(svgElement) === controller)
          controllers.delete(svgElement);
      },
    });
    controllers.set(svgElement, controller);
    return controller;
  }
  root.SituateBendMotion = Object.freeze({ create, names });
})(window);
