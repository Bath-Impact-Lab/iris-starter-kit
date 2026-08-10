<script setup lang="ts">
defineProps<{
  title: string;
  open: boolean;
}>();

defineEmits<{
  close: [];
}>();
</script>

<template>
  <div v-if="open" class="overlay" @click.self="$emit('close')">
    <div class="panel" role="dialog" :aria-label="title">
      <header class="head">
        <h2>{{ title }}</h2>
        <button type="button" class="icon-btn" aria-label="Close" @click="$emit('close')">×</button>
      </header>
      <div class="body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="foot">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 24px;
}

.panel {
  width: 85vw;
  max-width: 1400px;
  max-height: 90vh;
  background: #171b24;
  border: 1px solid #2a3140;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #2a3140;
}

.head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.body {
  padding: 20px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.06) transparent;
}

.foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid #2a3140;
}

.icon-btn {
  background: none;
  border: none;
  color: #8b93a7;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}

.icon-btn:hover {
  color: #e8eaed;
}

/* minimal scrollbar for webkit */
.body::-webkit-scrollbar { height: 8px; width: 8px; }
.body::-webkit-scrollbar-track { background: transparent; }
.body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 8px; }
</style>
