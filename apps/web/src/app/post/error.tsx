"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function PostError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-24">
      <section className="rounded-lg bg-[var(--surface-container-lowest)] p-6 shadow-[0_20px_40px_rgba(28,28,24,0.06)]">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-warm-900 text-white">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-3">
            <div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
                Agora · Post
              </div>
              <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-warm-900">
                Posting flow hit an unexpected error
              </h1>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-warm-700">
              The local session is still available. Next step: retry this screen
              or restart the posting flow if the error keeps happening.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={reset}
                className="btn-primary inline-flex items-center gap-2 rounded-md px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider motion-reduce:transition-none"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Try again
              </button>
              <Link
                href="/post"
                className="btn-secondary inline-flex items-center gap-2 rounded-md px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider motion-reduce:transition-none"
              >
                Restart flow
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
