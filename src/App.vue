<script setup lang="ts">
import { onMounted, ref } from 'vue';

const platform = ref('unknown');

onMounted(() => {
  platform.value = window.irisStarter?.platform ?? 'web';
});
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <span class="brand">IRIS Starter Kit</span>
      <span class="meta">v0.1.0 · {{ platform }}</span>
    </header>
    <main class="content">
      <h1>Bootstrap ready</h1>
      <p>Electron + Vue 3 + Vite + TypeScript</p>
      <p class="hint">Camera setup, calibration, and live view screens follow next.</p>
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid #2a2f3a;
  background: #141820;
}

.brand {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.meta {
  font-size: 12px;
  color: #8b93a7;
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
}

h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}

p {
  margin: 0;
  color: #aeb6c8;
  font-size: 14px;
}

.hint {
  margin-top: 12px;
  font-size: 12px;
  color: #6b7280;
}
</style>
