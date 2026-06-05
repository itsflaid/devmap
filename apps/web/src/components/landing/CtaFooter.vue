<template>
  <section class="relative z-10 mx-auto max-w-7xl px-5 pb-10 pt-5 sm:px-8">
    <div class="cta-panel relative overflow-hidden rounded-xl border border-aqua-400/15 p-8 shadow-panel sm:p-10 lg:p-12">
      <div class="moving-waves" aria-hidden="true">
        <span class="wave wave-one" />
        <span class="wave wave-two" />
        <span class="wave wave-three" />
      </div>

      <div class="relative z-10 grid gap-8 lg:grid-cols-[1fr_0.9fr] lg:items-center">
        <div>
          <h2 class="max-w-xl text-3xl font-extrabold leading-tight tracking-normal text-white sm:text-4xl">
            Ready to explore your codebase like
            <span class="text-aqua-400"> never before?</span>
          </h2>
          <p class="mt-5 max-w-lg text-base leading-7 text-slate-300">
            Install devmap and turn complexity into clarity.
          </p>
          <div class="mt-7 flex flex-wrap gap-4">
            <a href="#" class="inline-flex min-h-12 items-center gap-3 rounded-md bg-aqua-400 px-6 text-sm font-extrabold text-void shadow-aqua transition hover:-translate-y-0.5 hover:bg-aqua-300">
              Get Started with CLI
              <span>></span>
            </a>
            <a href="#" class="inline-flex min-h-12 items-center rounded-md border border-white/10 bg-black/20 px-6 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:border-aqua-400/45 hover:text-aqua-300">
              View Documentation
            </a>
          </div>
          <code class="mt-5 inline-flex rounded-md border border-white/10 bg-black/20 px-4 py-3 font-mono text-xs text-aqua-300">
            $ npx devmap analyze
          </code>
        </div>

        <div class="relative hidden min-h-72 lg:block">
          <div class="compass-orb">
            <div class="compass-ring ring-a" />
            <div class="compass-ring ring-b" />
            <div class="needle" />
            <div class="needle-dot" />
          </div>
        </div>
      </div>
    </div>

    <footer class="flex flex-col gap-5 px-1 py-8 text-sm text-slate-400 md:flex-row md:items-center md:justify-between">
      <p class="font-bold text-white">dev<span class="text-aqua-400">map</span></p>
      <div class="flex flex-wrap gap-7">
        <a href="#" class="transition hover:text-aqua-300">GitHub</a>
        <a href="#" class="transition hover:text-aqua-300">Docs</a>
        <a href="#" class="transition hover:text-aqua-300">CLI</a>
        <a href="#" class="transition hover:text-aqua-300">Blog</a>
      </div>
      <p>Made by Mufacoderz</p>
    </footer>
  </section>
</template>

<style scoped>
.cta-panel {
  background:
    radial-gradient(circle at 74% 45%, rgba(34, 228, 214, 0.28), transparent 18rem),
    linear-gradient(135deg, rgba(8, 20, 32, 0.96), rgba(1, 11, 20, 0.92));
}

.moving-waves {
  position: absolute;
  inset: auto -8rem -3rem 40%;
  height: 18rem;
  opacity: 0.55;
}

.wave {
  position: absolute;
  left: 0;
  right: 0;
  height: 8rem;
  border: 1px solid rgba(78, 250, 240, 0.18);
  border-color: rgba(78, 250, 240, 0.2) transparent transparent transparent;
  border-radius: 50%;
  transform-origin: center;
}

.wave-one {
  bottom: 0;
  animation: wave-drift 8s ease-in-out infinite;
}

.wave-two {
  bottom: 2.8rem;
  animation: wave-drift 10s ease-in-out -2s infinite reverse;
}

.wave-three {
  bottom: 5.6rem;
  animation: wave-drift 12s ease-in-out -4s infinite;
}

.compass-orb {
  position: absolute;
  right: 5%;
  top: 50%;
  width: 18rem;
  height: 18rem;
  transform: translateY(-50%);
}

.compass-ring {
  position: absolute;
  inset: 0;
  border: 1px solid rgba(78, 250, 240, 0.22);
  border-radius: 999px;
}

.ring-a {
  animation: compass-spin 18s linear infinite;
}

.ring-b {
  inset: 3rem;
  box-shadow: 0 0 60px rgba(34, 228, 214, 0.22);
  animation: compass-spin 12s linear reverse infinite;
}

.needle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 2.2rem;
  height: 10rem;
  border-radius: 999px;
  background: linear-gradient(180deg, #4efaf0 0%, rgba(78, 250, 240, 0.1) 100%);
  transform: translate(-50%, -50%) rotate(42deg);
  transform-origin: center;
  animation: needle-sweep 4.6s ease-in-out infinite;
}

.needle-dot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 3.3rem;
  height: 3.3rem;
  border: 0.7rem solid rgba(255, 255, 255, 0.85);
  border-radius: 999px;
  background: #16c8bd;
  box-shadow: 0 0 36px rgba(34, 228, 214, 0.5);
  transform: translate(-50%, -50%);
}

@keyframes wave-drift {
  0%, 100% { transform: translateX(-1rem) scaleX(1); }
  50% { transform: translateX(2rem) scaleX(1.08); }
}

@keyframes compass-spin {
  to { transform: rotate(360deg); }
}

@keyframes needle-sweep {
  0%, 100% { transform: translate(-50%, -50%) rotate(36deg); }
  50% { transform: translate(-50%, -50%) rotate(58deg); }
}
</style>
