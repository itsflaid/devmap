<script setup lang="ts">
const stacks = [
  ["TS", "TypeScript"],
  ["JS", "JavaScript"],
  ["PY", "Python"],
  ["GO", "Go"],
  ["RS", "Rust"],
  ["JV", "Java"],
  ["PHP", "PHP"],
  ["+", "& more"]
];
</script>

<template>
  <section class="relative z-10 mx-auto max-w-7xl px-5 py-7 sm:px-8">
    <div class="rounded-lg border border-white/10 bg-white/[0.025] px-6 py-6">
      <p class="text-center font-mono text-sm font-black uppercase text-aqua-300">Works with your stack</p>
      <div class="mt-7 grid grid-cols-2 gap-5 sm:grid-cols-4 lg:grid-cols-8">
        <div v-for="stack in stacks" :key="stack[1]" class="flex items-center justify-center gap-3 text-sm font-semibold text-slate-300">
          <span class="grid h-9 w-9 place-items-center rounded-md border border-white/10 bg-white/[0.04] font-mono text-xs font-black text-aqua-300">
            {{ stack[0] }}
          </span>
          {{ stack[1] }}
        </div>
      </div>
    </div>
  </section>
</template>
