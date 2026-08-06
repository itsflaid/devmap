import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type RevealOptions = {
  /** Distance (px) elements travel upward as they fade in. */
  y?: number;
  /** Delay between each element in the group, in seconds. */
  stagger?: number;
  duration?: number;
  /** ScrollTrigger "start" position relative to the container. */
  start?: string;
  ease?: string;
  /** Extra delay (s) before this group starts, relative to its own trigger. */
  delay?: number;
};

/**
 * Fades + slides a group of elements up into place as they scroll into
 * view. Shared by every landing/docs section so the site has one
 * consistent motion language instead of static, instantly-visible
 * blocks. Safe to call unconditionally — no-ops when there's nothing
 * to animate or the user prefers reduced motion.
 */
export function revealOnScroll(
  container: Element | null,
  selector: string,
  options: RevealOptions = {}
): void {
  if (!container || prefersReducedMotion()) return;

  const targets = container.querySelectorAll<HTMLElement>(selector);
  if (!targets.length) return;

  const {
    y = 22,
    stagger = 0.08,
    duration = 0.65,
    start = "top 85%",
    ease = "power2.out",
    delay = 0,
  } = options;

  gsap.set(targets, { opacity: 0, y });

  gsap.to(targets, {
    opacity: 1,
    y: 0,
    duration,
    stagger,
    ease,
    delay,
    scrollTrigger: {
      trigger: container,
      start,
      toggleActions: "play none none reverse",
    },
  });
}
