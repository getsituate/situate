const bridge = globalThis.__SITUATE_EXECUTOR__;
let worker;
bridge.receive = (payload) => {
  if (payload === "worker") {
    const dependency = globalThis.URL.createObjectURL(
      new globalThis.Blob(["export const value = 42;"], {
        type: "text/javascript",
      }),
    );
    const source = `import {value} from '${dependency}';
      let network;
      try { await fetch('https://executor.invalid/forbidden'); network = 'allowed'; }
      catch { network = 'blocked'; }
      postMessage({value, network, generated: new Function('return 6 * 7')()});
      for(;;) {}`;
    const url = globalThis.URL.createObjectURL(
      new globalThis.Blob([source], { type: "text/javascript" }),
    );
    worker = new globalThis.Worker(url, { type: "module" });
    worker.onmessage = (event) => bridge.send({ worker: event.data });
  } else if (payload === "stop") {
    worker.terminate();
    bridge.send({ stopped: true });
  } else if (payload === "network") {
    globalThis.fetch("https://executor.invalid/forbidden").then(
      () => bridge.send({ network: "allowed" }),
      () => bridge.send({ network: "blocked" }),
    );
  } else if (payload === "hang") {
    for (;;) {
      continue;
    }
  }
};
