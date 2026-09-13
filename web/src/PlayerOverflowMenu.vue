<script setup lang="ts">
import { computed, shallowRef, watch, type Component } from "vue";
import { ChevronLeft } from "@lucide/vue";

export interface OverflowAction {
  id: string;
  label: string;
  icon: Component;
  selected?: boolean;
  submenu?: boolean;
}

const props = defineProps<{
  open: boolean;
  hiddenIds: string[];
  quickActions: OverflowAction[];
  settingActions: OverflowAction[];
}>();

const emit = defineEmits<{
  activate: [id: string];
}>();

const activeView = shallowRef("");
const visibleQuickActions = computed(() =>
  props.quickActions.filter((action) => props.hiddenIds.includes(action.id)),
);
const visibleSettingActions = computed(() =>
  props.settingActions.filter((action) => props.hiddenIds.includes(action.id)),
);
const activeLabel = computed(
  () =>
    props.settingActions.find((action) => action.id === activeView.value)?.label ??
    "",
);

function activate(action: OverflowAction): void {
  if (action.submenu) {
    activeView.value = action.id;
    return;
  }
  emit("activate", action.id);
}

watch(
  () => props.open,
  (open) => {
    if (!open) activeView.value = "";
  },
);
watch(
  () => props.hiddenIds,
  (hidden) => {
    if (activeView.value && !hidden.includes(activeView.value)) {
      activeView.value = "";
    }
  },
  { deep: true },
);
</script>

<template>
  <Transition name="overflow-menu">
    <div v-if="open" class="popover overflow-popover">
      <template v-if="!activeView">
        <div v-if="visibleQuickActions.length" class="overflow-quick-actions">
          <button
            v-for="action in visibleQuickActions"
            :key="action.id"
            class="icon-button"
            :class="{ selected: action.selected }"
            :aria-label="action.label"
            :title="action.label"
            @click="activate(action)"
          >
            <component :is="action.icon" />
            <span
              v-if="action.id === 'seek-back' || action.id === 'seek-forward'"
              class="overflow-seek-number"
              aria-hidden="true"
            >5</span>
          </button>
        </div>
        <slot v-if="hiddenIds.includes('volume')" name="volume" />
        <div v-if="visibleSettingActions.length" class="overflow-settings">
          <button
            v-for="action in visibleSettingActions"
            :key="action.id"
            :class="['overflow-setting', { selected: action.selected }]"
            @click="activate(action)"
          >
            <component :is="action.icon" />
            <span>{{ action.label }}</span>
          </button>
        </div>
      </template>
      <template v-else>
        <div class="overflow-subview-header">
          <button
            class="icon-button"
            aria-label="Back"
            title="Back"
            @click="activeView = ''"
          >
            <ChevronLeft />
          </button>
          <b>{{ activeLabel }}</b>
        </div>
        <div class="overflow-subview">
          <slot :name="activeView" />
        </div>
      </template>
    </div>
  </Transition>
</template>
