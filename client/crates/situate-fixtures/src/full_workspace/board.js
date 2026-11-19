export default function defineUI({ vue, ui, dependencies }) {
  const view = vue.defineComponent({
    setup() {
      const { h, ref } = vue;
      const events = ref([]);
      const documents = ref([]);
      const status = ref("idle");
      async function load() {
        status.value = "loading";
        try {
          const [schedule, archive] = await Promise.all([
            dependencies.invoke("garden-calendar", "listEvents", {}),
            dependencies.invoke("garden-archive", "documentSourceList", {
              limit: 10,
            }),
          ]);
          if (
            !Array.isArray(schedule) ||
            archive?.status !== "ok" ||
            !Array.isArray(archive.items)
          )
            throw new Error("The schedule or archive is unavailable.");
          events.value = schedule;
          documents.value = archive.items;
          status.value = "ready";
        } catch {
          status.value = "error";
        }
      }
      return () =>
        h("section", { style: { padding: "24px", overflow: "auto" } }, [
          h("h2", "Garden board"),
          h(
            ui.SituateButton,
            {
              onClick: load,
              disabled: status.value === "loading",
            },
            () =>
              status.value === "ready"
                ? "Refresh"
                : "Load schedule and documents",
          ),
          status.value === "loading" && h("p", { role: "status" }, "Loading…"),
          status.value === "error" &&
            h("p", { role: "alert" }, "Could not load the garden board."),
          status.value === "ready" && [
            h("h3", "Schedule"),
            h(
              "ul",
              events.value.map((event) =>
                h("li", { key: event.title }, `${event.when} — ${event.title}`),
              ),
            ),
            h("h3", "Archive"),
            h(
              "ul",
              documents.value.map((document) =>
                h("li", { key: document.ref.id }, document.title),
              ),
            ),
          ],
        ]);
    },
  });
  return {
    views: [
      {
        id: "garden-board:main",
        title: () => "Garden board",
        icon: "folder",
        component: view,
      },
    ],
  };
}
