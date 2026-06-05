<script setup lang="ts">
const navItems = ["Features", "How It Works", "CLI", "Pricing", "Docs", "Blog"];
</script>

<template>
  <header class="relative z-20">
    <nav class="mx-auto flex max-w-7xl items-center justify-between px-5 py-7 sm:px-8">
      <a href="#" class="group flex items-center gap-3" aria-label="DevMap home">
        <span class="relative grid h-12 w-12 place-items-center">
          <span class="absolute inset-1 rounded-full border border-aqua-400/80 shadow-aqua transition group-hover:scale-105" />
          <span class="absolute h-1 w-9 rounded-full bg-aqua-400/85" />
          <span class="absolute h-9 w-1 rounded-full bg-aqua-400/85" />
          <span class="h-3 w-3 rounded-full bg-aqua-300 shadow-aqua" />
        </span>
        <span class="text-3xl font-extrabold tracking-normal text-white">
          dev<span class="text-aqua-400">map</span>
        </span>
      </a>

      <div class="hidden items-center gap-10 text-sm font-semibold text-white/90 lg:flex">
        <a v-for="item in navItems" :key="item" href="#" class="transition hover:text-aqua-300">
          {{ item }}
        </a>
      </div>

      <div class="flex items-center gap-3">
        <a href="#" class="hidden rounded-md border border-white/10 bg-white/[0.035] px-5 py-3 text-sm font-bold shadow-panel transition hover:border-aqua-400/45 hover:text-aqua-300 sm:inline-flex">
          GitHub
        </a>
        <a href="#" class="rounded-md bg-aqua-400 px-5 py-3 text-sm font-extrabold text-void shadow-aqua transition hover:bg-aqua-300">
          Get Started
        </a>
      </div>
    </nav>
  </header>
</template>
