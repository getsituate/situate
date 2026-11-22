# Plugin packages

Use plain JavaScript ES modules and Vue; no npm resolution, downloaded native code or external build pipeline. Split nontrivial code into cohesive local modules by responsibility. Use static imports and re-exports with explicit relative .js paths; ../ may stay within the same package. No extension inference, directory imports, absolute/URL imports, dynamic imports, import.meta, import attributes or circular module imports. All JavaScript modules and declared skills are captured from the same checked revision, with an 8 MiB combined text limit and 1 MiB per file. Prefer targeted reads and edits over unrelated rewrites.

plugin.json uses schemaVersion:2, id, name, description, optional skills (Markdown paths), serviceEntry (code-relative .js module), uiEntry (a separate code-relative .js module), kind (connection or tool), dependencies (local plugin IDs), exports (explicit service RPC names), components (explicit UI component export names), and platforms (macos or ios). At least one skill, serviceEntry or uiEntry is required. Skills-only packages need neither entry. Paths use ASCII letters/digits/dots/underscores/hyphens without traversal or symlinks. Only declare platforms actually implemented and verified; macOS evidence does not qualify iOS.

## Service entry

serviceEntry default-exports async function defineService({pluginId}), returning {tools:[{name,description,parameters,execute(args,context)}],exports:{name:(args,context)=>result}}. parameters is an object JSON schema. Tools return {content:[{type:"text",text:string}|{type:"image",data:string,mimeType:string}],details?,structuredContent?,isError?}; service exports return serializable data. The factory receives identity only, not host services. Initialization must have no effects: no network, processes, writes, credential changes, timers or background work. Shared service/UI modules must be pure because they evaluate independently in both realms. Never import the service factory into the UI or retain executable service closures there.

Each invocation receives its own immutable context: {invocationId,signal,files,config,data,credentials,process,network,dependencies:{invoke},progress(value),preview:{open,step,close}}. Use only that invocation's context for its effects; do not retain it for later work or use a global current-invocation variable. Forward context and its signal explicitly through nested calls. context.dependencies.invoke(pluginId,exportName,args) calls only declared dependencies and service exports through native admission. Progress values must be serializable. There is no files.watch API; timers and watchers do not acquire authority by retaining a context. Cancellation can terminate the shared plugin Worker, interrupting other invocations in its generation too. Never automatically redispatch interrupted work.

## UI entry

uiEntry default-exports function defineUI({vue,ui,navigation,service:{invoke},dependencies:{invoke,component}}), returning {views,settings,components:{name:VueComponent},dispose?}. It has no files, credentials, process or network host. Use await service.invoke(exportName,args) for native-admitted calls to this plugin's explicit service exports. await dependencies.invoke(pluginId,exportName,args) calls a declared dependency's service export. dependencies.component(pluginId,name) synchronously obtains an explicitly exported UI component in the UI realm; components do not cross Worker serialization. The manifest exports and components lists are separate. A shared utility module export is neither a service RPC nor a public component by itself.

Views are {id,title:()=>string,icon,component,reveal?}; settings is one such definition, not an array. Prefix IDs with the pluginId and a colon. Set icon to a supported Situate icon name, such as folder, calendar, tasks, notes, chat or settings. component is a Vue component, not a path. Use supplied vue.defineComponent/h/ref/reactive/computed/watch/lifecycle hooks or templates and ui.Situate* components. Components receive workspaceId/workspaceName/embedded/target/presentation and emit presentation/navigate. reveal(contentId,revision?) returns serializable presentation state. Restoring presentation must not perform actions. navigation.open takes a semantic target such as {kind:"view",viewId:pluginId+":main"}; navigation.reveal resolves content. Dispose owned presentation resources. Ordinary Vue views retain their hang/restart limitation; a stoppable service Worker does not make Vue rendering independently stoppable.

## Minimal entries

`service.js` (declare `greeting` in the manifest's `exports`):

```js
export default async function defineService() {
  return { exports: { greeting: async () => ({ text: "Hello" }) } };
}
```

`ui.js` (for plugin ID `sample`):

```js
export default function defineUI({ vue }) {
  return {
    views: [
      {
        id: "sample:main",
        title: () => "Sample",
        icon: "folder",
        component: vue.defineComponent({
          setup: () => () => vue.h("p", "Sample"),
        }),
      },
    ],
  };
}
```
