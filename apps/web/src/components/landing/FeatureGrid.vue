<script setup lang="ts">
const features = [
  {
    icon: "M",
    title: "Map",
    text: "Visualize your project architecture and dependencies."
  },
  {
    icon: "?",
    title: "Explain",
    text: "Get clear explanations of any file, function, or module."
  },
  {
    icon: "*",
    title: "Ask",
    text: "Ask questions about your codebase in natural language."
  },
  {
    icon: "D",
    title: "Docs",
    text: "Generate docs and summaries automatically from your code."
  },
  {
    icon: "O",
    title: "Onboard",
    text: "Onboard new team members 10x faster with AI."
  }
];
</script>

<template>
  <section class="relative z-10 mx-auto max-w-7xl px-5 py-10 sm:px-8" id="features">
    <div class="section-kicker mx-auto justify-center">
      <span class="kicker-mark">#</span>
      Powerful Features
    </div>

    <div class="mt-7 grid gap-5 md:grid-cols-2 lg:grid-cols-5">
      <article v-for="feature in features" :key="feature.title" class="feature-card group">
        <div class="icon-orb">
          <span>{{ feature.icon }}</span>
        </div>
        <h2 class="mt-7 text-xl font-extrabold text-white">{{ feature.title }}</h2>
        <p class="mt-4 text-sm leading-6 text-slate-300">{{ feature.text }}</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.section-kicker {
  display: flex;
  width: fit-content;
  align-items: center;
  gap: 0.75rem;
  color: #22e4d6;
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 0.86rem;
  font-weight: 900;
  text-transform: uppercase;
}

.kicker-mark {
  color: #4efaf0;
}

.feature-card {
  min-height: 16rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background:
    radial-gradient(circle at 28% 18%, rgba(34, 228, 214, 0.09), transparent 5.5rem),
    linear-gradient(145deg, rgba(255, 255, 255, 0.052), rgba(255, 255, 255, 0.016));
  padding: 2rem 1.8rem;
  transition: transform 220ms ease, border-color 220ms ease, box-shadow 220ms ease;
}

.feature-card:hover {
  border-color: rgba(78, 250, 240, 0.34);
  box-shadow: 0 18px 58px rgba(0, 0, 0, 0.34), 0 0 30px rgba(34, 228, 214, 0.1);
  transform: translateY(-0.35rem);
}

.icon-orb {
  display: grid;
  width: 4.25rem;
  height: 4.25rem;
  place-items: center;
  border-radius: 999px;
  background: rgba(34, 228, 214, 0.08);
  color: #4efaf0;
  box-shadow: inset 0 0 0 1px rgba(78, 250, 240, 0.12), 0 0 32px rgba(34, 228, 214, 0.12);
}

.icon-orb span {
  display: grid;
  width: 2.6rem;
  height: 2.6rem;
  place-items: center;
  border: 2px solid currentColor;
  border-radius: 999px;
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 1.2rem;
  font-weight: 900;
}
</style>
