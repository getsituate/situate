import { attributes, events } from "../../../contracts/diagnostics.json";
import {
  createContext,
  validateEvent,
  type Attributes,
  type Category,
  type Context,
  type EventInput,
  type EventName,
  type Initiator,
  type Level,
} from "./contract";

export const PRODUCER_BYTES = 256 * 1024;
export const BATCH_BYTES = 64 * 1024;
export const MAX_PRODUCERS = 16;
const MAX_EVENTS = 4096;
const priority: Record<Level, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};
const encoder = new TextEncoder();
export type Transport = (
  command: string,
  args: Record<string, unknown> | Uint8Array,
) => Promise<unknown>;
type Queued = { event: EventInput; bytes: number };
type State = {
  scope?: string;
  id?: string;
  registered: boolean;
  disabled: boolean;
  closed: boolean;
  released: boolean;
  queue: Queued[];
  bytes: number;
  dropped: number;
  sequence: number;
};
export interface Operation {
  readonly context: Context | undefined;
  finish(
    outcome?: "success" | "failure" | "cancelled" | "rejected" | "interrupted",
    errorCode?: string,
  ): void;
  child(category: Category, action: string, component: string): Operation;
  retry(attempt: number): Operation;
}
export interface Producer {
  emit(
    event: EventName,
    category: Category,
    attributes?: Attributes,
    context?: Context,
    level?: Level,
  ): void;
  operation(
    category: Category,
    action: string,
    component: string,
    parent?: Context,
    initiator?: Initiator,
  ): Operation;
  action(
    action: string,
    control: string,
    component: string,
  ): Context | undefined;
  close(): void;
}

const noopOperation: Operation = Object.freeze({
  context: undefined,
  finish() {},
  child: () => noopOperation,
  retry: () => noopOperation,
});
export const noopProducer: Producer = Object.freeze({
  emit() {},
  action: () => undefined,
  operation: () => noopOperation,
  close() {},
});

export function createDiagnostics(transport: Transport) {
  const states = new Set<State>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let stopped = false;
  let shuttingDown = false;

  function schedule(immediate = false): void {
    if (stopped || inFlight) return;
    if (timer !== undefined) {
      if (!immediate) return;
      clearTimeout(timer);
    }
    timer = setTimeout(
      () => {
        timer = undefined;
        void pump();
      },
      immediate ? 0 : 250,
    );
  }
  function lose(state: State, count = 1): void {
    state.dropped = Math.min(Number.MAX_SAFE_INTEGER, state.dropped + count);
  }
  function enqueue(state: State, item: Queued): void {
    while (
      state.bytes + item.bytes > PRODUCER_BYTES ||
      state.queue.length >= MAX_EVENTS
    ) {
      let index = -1;
      for (
        let level = 0;
        level < priority[item.event.level] && index < 0;
        level++
      ) {
        index = state.queue.findIndex(
          (queued) => priority[queued.event.level] === level,
        );
      }
      if (index < 0) {
        lose(state);
        return;
      }
      const [removed] = state.queue.splice(index, 1);
      state.bytes -= removed!.bytes;
      lose(state);
    }
    state.queue.push(item);
    state.bytes += item.bytes;
    schedule(state.bytes >= BATCH_BYTES - 512 || state.queue.length >= 64);
  }
  function capture(
    state: State,
    event: EventName,
    category: Category,
    attributes: Attributes = {},
    context?: Context,
    level: Level = "info",
  ): Queued | undefined {
    const data = validateEvent({
      schema_version: 1,
      event,
      category,
      level,
      attributes,
      timestamp_ms: Date.now(),
      sequence: state.sequence,
      ...(context === undefined ? {} : { context }),
    });
    if (!data) {
      lose(state);
      return;
    }
    const bytes = encoder.encode(JSON.stringify(data)).byteLength + 1;
    if (bytes > 16384 || state.sequence >= Number.MAX_SAFE_INTEGER) {
      lose(state);
      return;
    }
    state.sequence++;
    return { event: data, bytes };
  }
  async function pump(): Promise<void> {
    if (inFlight || stopped) return;
    const state = [...states].find(
      (candidate) =>
        !candidate.released &&
        (!candidate.registered ||
          candidate.queue.length ||
          candidate.closed ||
          (candidate.id && candidate.dropped)),
    );
    if (!state) return;
    // Rotation prevents a busy workspace from monopolizing the bridge.
    states.delete(state);
    states.add(state);
    inFlight = true;
    try {
      if (!state.registered) {
        state.registered = true;
        if (!state.closed) {
          const response = await transport(
            "diagnostics_register",
            state.scope === undefined ? {} : { scope: state.scope },
          );
          if (response && typeof response === "object") {
            const id = Object.getOwnPropertyDescriptor(
              response,
              "producer_id",
            )?.value;
            if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))
              state.id = id;
          }
        }
        if (!state.id) {
          state.disabled = true;
          state.queue = [];
          state.bytes = 0;
          state.dropped = 0;
        }
      } else if (state.id && state.queue.length) {
        const events: EventInput[] = [];
        let bytes = encoder.encode(
          JSON.stringify({ producer: state.id, events: [] }),
        ).byteLength;
        while (
          state.queue.length &&
          events.length < 64 &&
          bytes + state.queue[0]!.bytes <= BATCH_BYTES
        ) {
          const item = state.queue.shift()!;
          state.bytes -= item.bytes;
          bytes += item.bytes;
          events.push(item.event);
        }
        const body = encoder.encode(
          JSON.stringify({ producer: state.id, events }),
        );
        await transport("diagnostics_emit", body);
      } else if (state.closed) {
        state.released = true;
        try {
          if (state.id)
            await transport("diagnostics_release", { producer: state.id });
        } finally {
          states.delete(state);
        }
      }
      if (state.id && state.dropped && !state.closed && !stopped) {
        const count = state.dropped;
        state.dropped = 0;
        const item = capture(
          state,
          "diagnostics.dropped",
          "diagnostics",
          { count, error_code: "overload" },
          undefined,
          "warn",
        );
        if (item) enqueue(state, item);
      }
    } catch {
      if (!state.id) {
        state.disabled = true;
        state.queue = [];
        state.bytes = 0;
        state.dropped = 0;
      }
    } finally {
      inFlight = false;
      if (!stopped) schedule();
    }
  }
  function producer(scope?: string): Producer {
    const admitted =
      !stopped &&
      !shuttingDown &&
      states.size < MAX_PRODUCERS &&
      (scope === undefined ||
        (typeof scope === "string" && scope.length <= 4096));
    if (!admitted) return noopProducer;
    const state: State = {
      scope,
      registered: false,
      disabled: false,
      closed: false,
      released: false,
      queue: [],
      bytes: 0,
      dropped: 0,
      sequence: 0,
    };
    states.add(state);
    schedule();
    const api: Producer = {
      emit(event, category, attributes = {}, context, level = "info") {
        try {
          if (state.closed || stopped || state.disabled) return;
          const item = capture(
            state,
            event,
            category,
            attributes,
            context,
            level,
          );
          if (item) enqueue(state, item);
        } catch {
          /* Diagnostic admission must not change application outcomes. */
        }
      },
      action(action, control, component) {
        if (state.closed || state.disabled || stopped) return undefined;
        const context = createContext();
        if (!context) return undefined;
        api.emit(
          "ui.action",
          "ui",
          { action, control, component },
          context,
          "trace",
        );
        return context;
      },
      operation(category, action, component, parent, initiator = "user") {
        if (
          state.closed ||
          state.disabled ||
          stopped ||
          !attributes.action.includes(action) ||
          !attributes.component.includes(component) ||
          !events["operation.started"].includes(category)
        )
          return noopOperation;
        const context = createContext(parent, initiator);
        if (!context) return noopOperation;
        let started: number | undefined;
        try {
          started = performance.now();
        } catch {
          /* A missing clock omits elapsed time. */
        }
        let finished = false;
        api.emit("operation.started", category, { action, component }, context);
        const operation: Operation = {
          context,
          finish(outcome = "success", errorCode) {
            if (finished) return;
            finished = true;
            if (!attributes.outcome.includes(outcome)) outcome = "failure";
            if (
              errorCode !== undefined &&
              !attributes.error_code.includes(errorCode)
            )
              errorCode = "unknown";
            let duration: Attributes = {};
            try {
              const elapsed =
                started === undefined ? NaN : performance.now() - started;
              if (Number.isFinite(elapsed))
                duration = {
                  duration_ms: Math.min(86400000, Math.max(0, elapsed)),
                };
            } catch {
              /* No wall-clock duration fallback. */
            }
            api.emit(
              "operation.finished",
              category,
              {
                action,
                component,
                outcome,
                ...duration,
                ...(errorCode ? { error_code: errorCode } : {}),
              },
              context,
              outcome === "failure"
                ? "error"
                : outcome === "interrupted" ||
                    (outcome === "rejected" && errorCode !== undefined)
                  ? "warn"
                  : "info",
            );
          },
          child(childCategory, childAction, childComponent) {
            return api.operation(
              childCategory,
              childAction,
              childComponent,
              context,
              initiator,
            );
          },
          retry(attempt) {
            api.emit(
              "operation.retry",
              category,
              { action, component, attempt },
              context,
              "warn",
            );
            return api.operation(
              category,
              action,
              component,
              context,
              initiator,
            );
          },
        };
        return operation;
      },
      close() {
        if (state.closed) return;
        state.closed = true;
        setTimeout(() => {
          state.queue = [];
          state.bytes = 0;
          state.dropped = 0;
          schedule(true);
        }, 1000);
        schedule(true);
      },
    };
    return api;
  }
  return {
    producer,
    flush() {
      schedule(true);
    },
    shutdown() {
      if (stopped || shuttingDown) return;
      shuttingDown = true;
      for (const state of states) state.closed = true;
      schedule(true);
      setTimeout(() => {
        stopped = true;
        if (timer !== undefined) clearTimeout(timer);
        for (const state of states) {
          state.queue = [];
          state.bytes = 0;
          state.dropped = 0;
        }
        states.clear();
      }, 1000);
    },
    stats() {
      return {
        producers: states.size,
        queuedBytes: [...states].reduce((sum, state) => sum + state.bytes, 0),
        queuedEvents: [...states].reduce(
          (sum, state) => sum + state.queue.length,
          0,
        ),
        inFlight,
      };
    },
  };
}
