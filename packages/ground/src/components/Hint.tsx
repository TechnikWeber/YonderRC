import type { ReactNode } from 'react';

/**
 * A long explanation, collapsed. Exactly the shape the vehicle's setup page uses
 * (`<details class="hint">`), so the two halves of the product behave the same: the
 * summary carries the one line worth reading at a glance, the body carries the rest.
 *
 * Closed by default. These paragraphs are worth keeping — they hold the reasoning
 * behind settings that are easy to get wrong — but open, they were most of the
 * panel's height, and a wall of text is read by nobody.
 */
export function Hint({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="hint">
      <summary>{summary}</summary>
      <p>{children}</p>
    </details>
  );
}
