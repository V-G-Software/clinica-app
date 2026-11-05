<script setup lang="ts">
// Diálogo acessível (Reka UI): foco preso, Esc fecha, título anunciado.
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { X } from 'lucide-vue-next';
const aberto = defineModel<boolean>('aberto', { default: false });
defineProps<{ titulo: string; descricao?: string }>();
</script>
<template>
  <DialogRoot v-model:open="aberto">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/40" />
      <DialogContent class="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl dark:bg-zinc-900">
        <div class="mb-4 flex items-start justify-between gap-4">
          <div>
            <DialogTitle class="text-lg font-bold">{{ titulo }}</DialogTitle>
            <DialogDescription v-if="descricao" class="text-sm text-zinc-600 dark:text-zinc-300">{{ descricao }}</DialogDescription>
          </div>
          <DialogClose class="rounded-lg p-1" aria-label="Fechar"><X class="size-5" /></DialogClose>
        </div>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
