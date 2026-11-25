const FEEDBACK_MS = 2000;

/** Falls back to `execCommand` where the clipboard API is unavailable (it needs HTTPS or localhost). */
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
 * On success the button gets `[data-copied]` (styles swap the copy icon for a
 * check) and announces "Copied!" through aria-label, then reverts. The command
 * is read from the element's text, so a typing animation on the node does not matter.
 */
export function initCopyCommand(button: HTMLElement, commandEl: HTMLElement): void {
  const command = commandEl.textContent?.trim() ?? "";
  if (!command) return;
  const idleLabel = button.getAttribute("aria-label") ?? command;

  button.addEventListener("click", async () => {
    const ok = await copyText(command);
    if (!ok) return;

    button.setAttribute("data-copied", "true");
    button.setAttribute("aria-label", "Copied!");

    window.setTimeout(() => {
      button.removeAttribute("data-copied");
      button.setAttribute("aria-label", idleLabel);
    }, FEEDBACK_MS);
  });
}