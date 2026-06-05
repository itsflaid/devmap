<script setup lang="ts">
const sideNav = ["Overview", "Architecture", "Modules", "Dependencies", "Files", "Search", "Ask AI", "Settings"];

const orbitNodes = [
  { label: "api", className: "node-api" },
  { label: "db", className: "node-db" },
  { label: "ui", className: "node-ui" },
  { label: "auth", className: "node-auth" },
  { label: "docs", className: "node-docs" },
  { label: "test", className: "node-test" },
  { label: "cli", className: "node-cli" },
  { label: "map", className: "node-map" }
];
</script>

<template>
  <section class="relative z-10 mx-auto grid max-w-7xl gap-12 px-5 pb-16 pt-10 sm:px-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:pb-20 lg:pt-12">
    <div>
      <p class="glow-badge mb-8 inline-flex items-center gap-3 rounded-md border border-aqua-400/20 bg-aqua-400/7 px-4 py-3 font-mono text-xs font-bold uppercase tracking-normal text-aqua-300">
        <span class="h-2 w-2 rounded-full bg-aqua-300 shadow-aqua" />
        AI-powered project understanding
      </p>

      <h1 class="max-w-2xl text-5xl font-extrabold leading-[1.07] tracking-normal text-white sm:text-6xl lg:text-7xl">
        Understand any
        <span class="block text-aqua-400">codebase.</span>
      </h1>
      <p class="mt-6 max-w-xl text-lg leading-8 text-slate-300">
        devmap helps you map, explain, and explore any codebase instantly. Save hours of reading and start building with confidence.
      </p>

      <div class="mt-9 flex flex-wrap items-center gap-4">
        <a href="#" class="inline-flex min-h-14 items-center gap-3 rounded-md bg-aqua-400 px-7 text-sm font-extrabold text-void shadow-aqua transition hover:-translate-y-0.5 hover:bg-aqua-300">
          <span class="font-mono text-base">>_</span>
          Try it with CLI
        </a>
        <a href="#" class="inline-flex min-h-14 items-center gap-3 rounded-md border border-white/10 bg-white/[0.035] px-7 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:border-aqua-400/45 hover:text-aqua-300">
          View on GitHub
        </a>
      </div>

      <div class="mt-7 inline-flex items-center gap-4 rounded-md border border-white/10 bg-white/[0.035] px-5 py-4 shadow-panel">
        <code class="font-mono text-sm text-slate-100">npx devmap analyze</code>
        <button class="grid h-7 w-7 place-items-center rounded border border-white/10 text-slate-400 transition hover:border-aqua-400/50 hover:text-aqua-300" aria-label="Copy command">
          <span class="h-3 w-3 rounded-sm border border-current" />
        </button>
      </div>
    </div>

    <div class="app-shell relative mx-auto w-full max-w-3xl overflow-hidden rounded-lg border border-white/10 bg-[#07111c]/95 shadow-panel">
      <div class="flex h-11 items-center gap-2 border-b border-white/10 px-4">
        <span class="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span class="h-3 w-3 rounded-full bg-[#ffbd2e]" />
        <span class="h-3 w-3 rounded-full bg-[#28c840]" />
        <span class="ml-4 flex items-center gap-2 font-mono text-sm font-bold text-white">
          <span class="h-5 w-5 rounded-full border border-aqua-400/70" />
          devmap
        </span>
      </div>

      <div class="grid min-h-[430px] grid-cols-[8.2rem_1fr_10.5rem] max-md:grid-cols-1">
        <aside class="border-r border-white/10 bg-black/20 p-3 max-md:hidden">
          <a v-for="(item, index) in sideNav" :key="item" href="#" :class="['flex items-center gap-2 rounded-md px-3 py-3 text-xs font-semibold', index === 0 ? 'bg-aqua-400/12 text-aqua-300' : 'text-slate-400']">
            <span class="h-2 w-2 rounded-full border border-current" />
            {{ item }}
          </a>
        </aside>

        <section class="relative min-h-[430px] overflow-hidden p-5">
          <p class="relative z-10 text-sm font-bold text-white">Architecture Map</p>
          <div class="architecture-map">
            <div class="orbit-ring ring-one" />
            <div class="orbit-ring ring-two" />
            <div class="center-cube">
              <span />
            </div>
            <div v-for="node in orbitNodes" :key="node.label" :class="['orbit-node', node.className]">
              {{ node.label }}
            </div>
            <svg class="node-lines" viewBox="0 0 520 360" aria-hidden="true">
              <line x1="260" y1="180" x2="160" y2="94" />
              <line x1="260" y1="180" x2="360" y2="82" />
              <line x1="260" y1="180" x2="416" y2="184" />
              <line x1="260" y1="180" x2="350" y2="286" />
              <line x1="260" y1="180" x2="168" y2="275" />
              <line x1="260" y1="180" x2="110" y2="190" />
              <line x1="260" y1="180" x2="240" y2="62" />
              <line x1="260" y1="180" x2="278" y2="306" />
            </svg>
          </div>
        </section>

        <aside class="border-l border-white/10 bg-black/20 p-4 max-md:hidden">
          <p class="text-sm font-bold text-white">UserService.ts</p>
          <p class="mt-1 font-mono text-xs text-slate-500">services/user</p>
          <p class="mt-8 text-xs font-bold text-white">Summary</p>
          <p class="mt-3 text-xs leading-5 text-slate-400">
            Handles user-related operations including authentication, profile management, and preferences.
          </p>
          <p class="mt-7 text-xs font-bold text-white">Dependencies (4)</p>
          <ul class="mt-3 space-y-2 text-xs text-slate-400">
            <li>Database</li>
            <li>AuthService</li>
            <li>EmailService</li>
            <li>Logger</li>
          </ul>
          <p class="mt-7 text-xs font-bold text-white">Exports</p>
          <p class="mt-3 text-xs text-slate-400">UserService</p>
        </aside>
      </div>
    </div>
  </section>
</template>

<style scoped>
.glow-badge {
  box-shadow: 0 0 34px rgba(34, 228, 214, 0.12);
}

.app-shell {
  animation: panel-rise 900ms ease both;
}

.architecture-map {
  position: absolute;
  inset: 2.5rem 1rem 1rem;
}

.node-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.node-lines line {
  stroke: rgba(78, 250, 240, 0.26);
  stroke-width: 1;
  stroke-dasharray: 5 9;
  animation: dash-flow 7s linear infinite;
}

.orbit-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  border: 1px solid rgba(78, 250, 240, 0.1);
  border-radius: 999px;
  transform: translate(-50%, -50%);
}

.ring-one {
  width: 15rem;
  height: 15rem;
  animation: spin-slow 26s linear infinite;
}

.ring-two {
  width: 10rem;
  height: 10rem;
  animation: spin-slow 18s linear reverse infinite;
}

.center-cube {
  position: absolute;
  left: 50%;
  top: 50%;
  display: grid;
  width: 4.75rem;
  height: 4.75rem;
  place-items: center;
  border: 1px solid rgba(78, 250, 240, 0.45);
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(78, 250, 240, 0.28), rgba(22, 200, 189, 0.72));
  box-shadow: 0 0 48px rgba(34, 228, 214, 0.38);
  transform: translate(-50%, -50%) rotate(45deg);
  animation: cube-pulse 3.4s ease-in-out infinite;
}

.center-cube span {
  width: 2rem;
  height: 2rem;
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 8px;
}

.orbit-node {
  position: absolute;
  display: grid;
  width: 3.3rem;
  height: 3.3rem;
  place-items: center;
  border: 1px solid rgba(78, 250, 240, 0.2);
  border-radius: 14px;
  background: rgba(7, 17, 28, 0.92);
  color: #4efaf0;
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 0.68rem;
  font-weight: 800;
  text-transform: uppercase;
  box-shadow: 0 0 30px rgba(34, 228, 214, 0.14);
  animation: node-float 4.8s ease-in-out infinite;
}

.node-api { left: 28%; top: 15%; animation-delay: -0.8s; }
.node-db { right: 24%; top: 16%; animation-delay: -2.1s; }
.node-ui { right: 12%; top: 44%; animation-delay: -1.2s; }
.node-auth { right: 31%; bottom: 12%; animation-delay: -3.3s; }
.node-docs { left: 36%; bottom: 9%; animation-delay: -1.7s; }
.node-test { left: 13%; top: 48%; animation-delay: -2.8s; }
.node-cli { left: 21%; bottom: 21%; animation-delay: -0.2s; }
.node-map { left: 45%; top: 7%; animation-delay: -3.9s; }

@keyframes panel-rise {
  from { opacity: 0; transform: translateY(20px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes spin-slow {
  to { transform: translate(-50%, -50%) rotate(360deg); }
}

@keyframes dash-flow {
  to { stroke-dashoffset: -96; }
}

@keyframes cube-pulse {
  50% { box-shadow: 0 0 70px rgba(34, 228, 214, 0.55); transform: translate(-50%, -50%) rotate(45deg) scale(1.06); }
}

@keyframes node-float {
  0%, 100% { transform: translate3d(0, 0, 0); }
  50% { transform: translate3d(0.45rem, -0.75rem, 0); }
}
</style>
