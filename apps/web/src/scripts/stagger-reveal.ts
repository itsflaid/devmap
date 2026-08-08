function prefersReducedMotion(): boolean {
  return (
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type StaggerRevealOptions = {
  /** Distance (px) elements travel upward as they fade in. */
  y?: number;
  /** Delay between each element revealing, in ms. */
  staggerMs?: number;
  /** IntersectionObserver threshold. */
  threshold?: number;
};

/**
 * Lightweight fade-up-on-scroll for elements that shouldn't pull in
 * GSAP/ScrollTrigger, elements above or near the fold (Hero), or
 * mobile fallbacks that already skip GSAP for other reasons
 * (CommandsSection's card list). Toggles inline opacity/transform on
 * IntersectionObserver and lets the element's own CSS `transition`
 * handle the animating.
 *
 * For everything below the fold that doesn't have this constraint,
 * prefer the GSAP-based `revealOnScroll` in `scroll-reveal.ts`
 * instead, it's the site's default motion language.
 *
 * Expects each target element to already define a CSS transition on
 * `opacity` and `transform`. Safe to call unconditionally: no-ops
 * when there's nothing to animate, IntersectionObserver isn't
 * available, or the user prefers reduced motion.
 */
export function staggerReveal(
  elements: NodeListOf<HTMLElement> | HTMLElement[],
  options: StaggerRevealOptions = {}
): void {
  const targets = Array.from(elements);
  if (
    !targets.length ||
    prefersReducedMotion() ||
    !("IntersectionObserver" in window)
  ) {
    return;
  }

  const { y = 12, staggerMs = 80, threshold = 0.2 } = options;

  targets.forEach((el) => {
    el.style.opacity = "0";
    el.style.transform = `translateY(${y}px)`;
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement;
          setTimeout(() => {
            el.style.opacity = "1";
            el.style.transform = "none";
          }, index * staggerMs);
          observer.unobserve(el);
        }
      });
    },
    { threshold }
  );

  targets.forEach((el) => observer.observe(el));
}
