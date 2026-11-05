<script setup lang="ts">
// Só em desenvolvimento: sem ?org= e sem subdomínio, escolhe um cenário do mock.
const ORGS = [
  { slug: 'modelo-otorrino', nome: 'Clínica Modelo Otorrino', cor: '#3B5BFD' },
  { slug: 'fisio-movimento', nome: 'Fisio Movimento', cor: '#047857' },
  { slug: 'vet-amigo', nome: 'Clínica Vet Amigo', cor: '#C2410C' },
];
</script>
<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6">
    <h1 class="text-xl font-bold">Escolha a organização (desenvolvimento)</h1>
    <a v-for="o in ORGS" :key="o.slug" :href="`/?org=${o.slug}`" class="flex min-h-14 items-center gap-3 rounded-xl border-2 px-4 font-semibold" :style="{ borderColor: o.cor, color: o.cor }">
      <span class="size-4 rounded-full" :style="{ background: o.cor }" /> {{ o.nome }}
    </a>
  </main>
</template>
