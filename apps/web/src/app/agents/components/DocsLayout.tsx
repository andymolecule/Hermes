"use client";

export function DocsLayout({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full min-h-screen">
      {/* Sidebar — hidden on mobile, fixed flush left on lg+ */}
      <aside className="hidden lg:block w-[240px] flex-shrink-0">
        <div className="fixed left-0 top-16 w-[240px] h-[calc(100vh-4rem)] overflow-y-auto border-r border-warm-900/10 bg-warm-100 px-5 py-8 scrollbar-thin">
          {sidebar}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        <div className="max-w-3xl mx-auto px-6 sm:px-8 py-12">
          {children}
        </div>
      </main>
    </div>
  );
}
