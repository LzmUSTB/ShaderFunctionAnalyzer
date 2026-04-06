<template>
  <div class="panel-frame">
    <div v-if="title" class="panel-header">{{ title }}</div>
    <slot />
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' },
})
</script>

<style scoped>
.panel-frame {
  display: flex;
  flex-direction: column;
  background: #212121;
  overflow: hidden;
}

.panel-header {
  font-size: 16px;
  user-select: none;
  background-color: #212121;
  font-weight: bold;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #ffffff;
  padding: 0.5em;
  border-bottom: 1px solid #6a6a6a;
  flex-shrink: 0;
}
</style>
