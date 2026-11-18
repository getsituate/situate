module.exports = {
  forbidden: [
    {
      name: "no-runtime-import-cycles",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "resolve-workspace-imports",
      severity: "error",
      from: {},
      to: {
        path: "^@situate/(?:ui|localization)(?:/|$)",
        couldNotResolve: true,
      },
    },
  ],
  options: {
    tsConfig: { fileName: "app/tsconfig.json" },
    tsPreCompilationDeps: false,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "browser", "default"],
    },
    doNotFollow: { path: "(?:^|/)node_modules/" },
    exclude: {
      path: "(?:^|/)(?:__tests__|tests)/|\\.(?:test|spec)\\.[^/]+$|^app/src/(?:test-setup|ui/(?:select-test|popover-test-environment))\\.ts$",
    },
  },
};
