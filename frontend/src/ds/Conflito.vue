<script setup lang="ts">
// 412 CONFLITO_VERSAO: outra pessoa alterou o registro. Nunca reenviamos com If-Match: *.
import Aviso from './Aviso.vue';
import Botao from './Botao.vue';
defineEmits<{ recarregar: [] }>();
</script>
<template>
  <Aviso tipo="atencao">
    Outra pessoa alterou este registro enquanto você editava. Recarregue para ver a versão atual e refaça a sua alteração.
    <div class="mt-2"><Botao variante="secundario" @click="$emit('recarregar')">Recarregar a versão atual</Botao></div>
  </Aviso>
</template>
