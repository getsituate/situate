export default ({ vue, ui, navigation, service }) => {
  const count = vue.ref(0);
  const read = async () => {
    count.value = await service.invoke("readCount", {});
  };
  const increment = async () => {
    count.value = await service.invoke("increment", {});
  };
  window.nativePluginOpen = (viewId) =>
    navigation.open({ kind: "view", viewId });
  window.nativePluginInitializations =
    (window.nativePluginInitializations ?? 0) + 1;
  const counter = {
    components: { SituateButton: ui.SituateButton },
    setup: () => {
      vue.onMounted(read);
      return { count, increment };
    },
    template:
      '<section data-native-plugin="counter"><div data-native-pixel style="width:96px;height:48px;background:rgb(33,165,216)"></div><h2>Plugin counter</h2><output>{{ count }}</output><SituateButton @click="increment">Increment plugin counter</SituateButton></section>',
  };
  return {
    views: [
      {
        id: "native-counter:counter",
        title: () => "Plugin counter",
        icon: "folder",
        component: counter,
      },
    ],
    settings: {
      id: "native-counter:settings",
      title: () => "Counter settings",
      icon: "settings",
      component: {
        template:
          '<section data-native-plugin="settings"><h2>Counter settings</h2></section>',
      },
    },
  };
};
