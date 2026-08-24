import { lazy, Suspense } from "react";
import { RouterProvider, useRouter, normalise, SiteHeader, SiteFooter } from "./components/Shell.jsx";
import Arena from "./components/Arena";
import { StandingsPage, HeadToHeadPage, FightersPage, FighterProfilePage, Skeleton } from "./components/Pages.jsx";

// The admin panel is the largest component and is never opened by a visitor,
// so it is split out and fetched only when /admin is hit.
const AdminPanel = lazy(() => import("./components/AdminPanel"));

function Routes() {
  const { path } = useRouter();
  const p = normalise(path);

  if (p === "/admin") {
    return (
      <Suspense fallback={<div className="p-8"><Skeleton className="h-64 w-full" /></div>}>
        <AdminPanel />
      </Suspense>
    );
  }

  // The admin panel brings its own chrome; everything else shares the shell.
  return (
    <div className="min-h-screen">
      <SiteHeader />
      {p === "/hall" || p === "/standings" ? (
        <StandingsPage />
      ) : p === "/head-to-head" ? (
        <HeadToHeadPage />
      ) : p === "/fighters" || p === "/models" ? (
        <FightersPage />
      ) : p.startsWith("/fighter/") || p.startsWith("/model/") ? (
        <FighterProfilePage />
      ) : (
        <Arena />
      )}
      <SiteFooter />
    </div>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <Routes />
    </RouterProvider>
  );
}
