<script setup lang="ts">
import AiAgentsSection from "@/components/landing/AiAgentsSection.vue";
import ComparisonSection from "@/components/landing/ComparisonSection.vue";
import FeaturesSection from "@/components/landing/FeaturesSection.vue";
import FooterCtaSection from "@/components/landing/FooterCtaSection.vue";
import HeroSection from "@/components/landing/HeroSection.vue";
import HowItWorksSection from "@/components/landing/HowItWorksSection.vue";
import OnboardingSection from "@/components/landing/OnboardingSection.vue";
import OpenSourceSection from "@/components/landing/OpenSourceSection.vue";
import ProblemSection from "@/components/landing/ProblemSection.vue";
import SiteFooter from "@/components/landing/SiteFooter.vue";
import SiteHeader from "@/components/landing/SiteHeader.vue";
</script>

<template>
  <div class="landing-page">
    <!--
      PAGE STRUCTURE

      01. Header
      02. Hero - pahami codebase dalam menit
      03. Problem - AI menulis kode lebih cepat dari developer memahaminya
      04. How It Works - tiga command untuk full understanding
      05. Features - static analysis dahulu, AI untuk interpretasi
      06. For AI Agents - agent membutuhkan project map
      07. Onboarding - developer tahu harus mulai dari mana
      08. Comparison - dengan DevMap versus going in blind
      09. Open Source - gratis selamanya, dukungan opsional
      10. Footer CTA - install DevMap dan baca dokumentasi
      11. Footer
    -->
    <SiteHeader />

    <main>
      <HeroSection />
      <ProblemSection />
      <HowItWorksSection />
      <FeaturesSection />
      <AiAgentsSection />
      <OnboardingSection />
      <ComparisonSection />
      <OpenSourceSection />
      <FooterCtaSection />
    </main>

    <SiteFooter />
  </div>
</template>

<style scoped>
/* Landing page composition styles. */
</style>
