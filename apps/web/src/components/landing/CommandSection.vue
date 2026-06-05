<script setup lang="ts">
const commands = [
  ["devmap analyze", "Analyze your codebase"],
  ["devmap explain <file>", "Explain any file or module"],
  ["devmap ask", "Ask anything about your codebase"],
  ["devmap docs", "Generate project documentation"]
];
</script>

<template>
  <section class="relative z-10 mx-auto max-w-7xl px-5 py-12 sm:px-8">
    <div class="section-kicker mx-auto justify-center">
      <span>>_</span>
      Built for Developers
    </div>

    <div class="mt-8 grid gap-5 lg:grid-cols-[1.6fr_repeat(4,0.78fr)]">
      <div class="terminal-card min-h-52 p-6 font-mono">
        <p class="text-sm text-slate-100"><span class="text-aqua-300">$</span> npx <span class="text-aqua-300">devmap</span> analyze</p>
        <ul class="mt-5 space-y-2 text-sm text-slate-300">
          <li><span class="text-aqua-300">/</span> Scanning codebase...</li>
          <li><span class="text-aqua-300">/</span> Analyzing architecture...</li>
          <li><span class="text-aqua-300">/</span> Building dependency graph...</li>
          <li><span class="text-aqua-300">/</span> Generating insights...</li>
        </ul>
        <p class="mt-6 text-base font-bold text-aqua-300">Done in 12.4s</p>
      </div>

      <article v-for="command in commands" :key="command[0]" class="command-card">
        <div class="command-icon">>_</div>
        <h2 class="mt-7 font-extrabold text-white">{{ command[0] }}</h2>
        <p class="mt-3 text-sm leading-6 text-slate-300">{{ command[1] }}</p>
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

.terminal-card,
.command-card {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.052), rgba(255, 255, 255, 0.016));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.command-card {
  min-height: 13.5rem;
  padding: 1.8rem 1.5rem;
  text-align: center;
  transition: transform 220ms ease, border-color 220ms ease;
}

.command-card:hover {
  border-color: rgba(78, 250, 240, 0.34);
  transform: translateY(-0.35rem);
}

.command-icon {
  display: grid;
  width: 4rem;
  height: 4rem;
  margin-inline: auto;
  place-items: center;
  border-radius: 999px;
  background: rgba(34, 228, 214, 0.08);
  color: #4efaf0;
  font-family: "JetBrains Mono", Consolas, monospace;
  font-weight: 900;
  box-shadow: 0 0 34px rgba(34, 228, 214, 0.12);
}
</style>
