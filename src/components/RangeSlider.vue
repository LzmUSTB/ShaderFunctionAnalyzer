<template>
  <div class="range-slider">
    <div class="slider-row">
      <!-- Min bound -->
      <input class="bound-input" type="number" :step="isInt ? 1 : 0.1" :value="localMin"
        @change="localMin = Number($event.target.value)" title="min" />

      <!-- Slider -->
      <input class="slider" type="range" :min="localMin" :max="localMax" :step="isInt ? 1 : 0.01" :value="modelValue"
        @input="emit('update:modelValue', Number($event.target.value))" />

      <!-- Max bound -->
      <input class="bound-input" type="number" :step="isInt ? 1 : 0.1" :value="localMax"
        @change="localMax = Number($event.target.value)" title="max" />
    </div>

    <!-- Value display / direct edit -->
    <div class="value-row">
      <input class="value-input" type="number" :step="isInt ? 1 : 0.01" :value="modelValue"
        @change="emit('update:modelValue', clamp(Number($event.target.value)))" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  isInt: { type: Boolean, default: false },
  min: { type: Number, default: -10 },
  max: { type: Number, default: 10 },
})

const emit = defineEmits(['update:modelValue'])

const localMin = ref(props.min)
const localMax = ref(props.max)

function clamp(v) {
  return Math.min(localMax.value, Math.max(localMin.value, v))
}
</script>

<style scoped>
.range-slider {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.bound-input {
  width: 36px;
  background: #1e1e1e;
  border: 1px solid #444;
  color: #aaa;
  font-size: 0.5em;
  padding: 1px 3px;
  text-align: center;
  /* hide spinners */
  -moz-appearance: textfield;
}

.bound-input::-webkit-inner-spin-button,
.bound-input::-webkit-outer-spin-button {
  display: none;
}

.slider {
  flex: 1;
  min-width: 0;
}

.value-row {
  display: flex;
  justify-content: flex-end;
}

.value-input {
  width: 60px;
  background: #1e1e1e;
  border: 1px solid #444;
  color: #e0e0e0;
  font-size: 0.5em;
  padding: 1px 4px;
  text-align: right;
  -moz-appearance: textfield;
}

.value-input::-webkit-inner-spin-button,
.value-input::-webkit-outer-spin-button {
  display: none;
}

.value-input:focus,
.bound-input:focus {
  outline: none;
  border-color: #5dade2;
}
</style>
