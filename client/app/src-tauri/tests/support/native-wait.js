window.nativeSmokeWait = (() => {
  const now = () => performance.now();
  const timeoutError = (message) => {
    const error = new Error(message);
    error.name = "NativeSmokeTimeout";
    return error;
  };
  const within = async (operation, deadline, message) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw timeoutError(message);
    let timer;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => {
          if (now() >= deadline) throw timeoutError(message);
          return operation();
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(timeoutError(message)), remaining);
        }),
      ]);
      if (now() >= deadline) throw timeoutError(message);
      return value;
    } catch (error) {
      if (now() >= deadline) throw timeoutError(message);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  const scope = (deadline) => ({
    invoke: (command, args, { timeout = 10000 } = {}) =>
      within(
        () => window.__TAURI_INTERNALS__.invoke(command, args),
        Math.min(deadline, now() + timeout),
        `Native IPC timed out: ${command}; the native operation may still complete`,
      ),
    wait: async (probe, message, { timeout = 15000, interval = 25 } = {}) => {
      const until = Math.min(deadline, now() + timeout);
      const transition = scope(until);
      while (true) {
        const value = await within(() => probe(transition), until, message);
        if (value) return value;
        await new Promise((resolve) => {
          setTimeout(resolve, Math.min(interval, Math.max(0, until - now())));
        });
      }
    },
  });
  // The native process owns the journey deadline, including WebView reloads.
  return scope(Infinity);
})();
