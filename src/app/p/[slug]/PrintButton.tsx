"use client";

/** "Download PDF": the browser's print dialog with "Save as PDF", using the print styles on this page. */
export function PrintButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      Download PDF
    </button>
  );
}
