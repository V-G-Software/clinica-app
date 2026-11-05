<script setup lang="ts">
defineProps<{ titulo: string; texto?: string | null }>();
</script>
<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
    <slot name="icone" />
    <h1 class="text-2xl font-bold">{{ titulo }}</h1>
    <p v-if="texto" class="text-zinc-600 dark:text-zinc-300">{{ texto }}</p>
    <slot />
  </main>
</template>
