/* global window */
import { invoke as original } from "@situate-native-ios/actual-core";
import { createIpcTrace } from "./native-ios-ipc-trace.mjs";
export * from "@situate-native-ios/actual-core";

const trace = createIpcTrace(original);
window.nativeIOSCloseTrace = trace;
export const invoke = (...args) => trace.invoke(...args);
