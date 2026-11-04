/**
 * Line numbers for many nodes of one file. ts-morph's `getStartLineNumber()`
 * recounts newlines from the top of the text on every call, so a generated file
 * with n declarations costs O(n * size) and a 4 MB file runs for minutes.
 */
export class LineIndex {
  private readonly breaks: number[] = [];

  constructor(text: string) {
    for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
      this.breaks.push(at);
    }
  }

  /** 1-based line of the character at `position`: one more than the newlines before it. */
  lineAt(position: number): number {
    let low = 0;
    let high = this.breaks.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.breaks[middle] < position) low = middle + 1;
      else high = middle;
    }
    return low + 1;
  }
}
