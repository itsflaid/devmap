<script setup lang="ts">
import CommandSection from "@/components/landing/CommandSection.vue";
import CtaFooter from "@/components/landing/CtaFooter.vue";
import FeatureGrid from "@/components/landing/FeatureGrid.vue";
import HeroSection from "@/components/landing/HeroSection.vue";
import SiteHeader from "@/components/landing/SiteHeader.vue";
import StackStrip from "@/components/landing/StackStrip.vue";
</script>

<template>
  <main class="relative min-h-screen overflow-hidden bg-void text-white">
    <div class="pointer-events-none absolute inset-0 bg-grid bg-[length:76px_76px] opacity-[0.055]" />
    <div class="pointer-events-none absolute left-1/2 top-0 h-[760px] w-[760px] -translate-x-1/2 rounded-full bg-aqua-400/5 blur-3xl" />

    <SiteHeader />
    <HeroSection />
    <FeatureGrid />
    <CommandSection />
    <StackStrip />
    <CtaFooter />
  </main>
</template>
