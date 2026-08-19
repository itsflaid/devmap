const FEEDBACK_MS = 2000;

/**
 * Copy text to the clipboard with a legacy fallback for non-secure contexts
 * (clipboard API requires HTTPS or localhost).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  }
}

/**
 * Wire a copy-to-clipboard CTA. On success the button flips to a "copied"
 * state (styled via `[data-copied]`, e.g. icon copy → check, accent color)
 * and announces "Copied!" through aria-label, then reverts. The command text
 * is read from the element itself, so it works regardless of any
 * typewriter/typing animation on the same node.
 */
export function initCopyCommand(button: HTMLElement, commandEl: HTMLElement): void {
  const command = commandEl.textContent?.trim() ?? "";
  if (!command) return;

  button.addEventListener("click", async () => {
    const ok = await copyText(command);
    if (!ok) return;

    button.setAttribute("data-copied", "true");
    button.setAttribute("aria-label", "Copied!");

    window.setTimeout(() => {
      button.removeAttribute("data-copied");
      button.setAttribute("aria-label", command);
    }, FEEDBACK_MS);
  });
}