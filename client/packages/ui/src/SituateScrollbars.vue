<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { installScrollbars } from "./scrollbars";
import "./scrollbars.css";
let release: (() => void) | undefined;
onMounted(() => {
  release = installScrollbars(document);
});
onBeforeUnmount(() => release?.());
</script>
<template><slot /></template>
