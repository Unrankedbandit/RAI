import { DeviceFrame } from "./components/stage/DeviceFrame";
import { MobileAppShell } from "./shell/MobileAppShell";

/**
 * Stage: on wide viewports, iOS + Android frames side by side; on a real
 * phone (narrow viewport), the app itself goes full-screen — no frame.
 */
export default function App() {
  return (
    <div className="min-h-full bg-surface-2 sm:px-6 sm:py-8">
      <header className="mx-auto mb-8 hidden max-w-4xl text-center sm:block">
        <div className="mb-1 text-[11px] font-semibold tracking-[0.2em] text-brand uppercase">
          RAI · Solar Parcel Intelligence
        </div>
        <h1 className="text-2xl font-semibold text-ink">Mobile App — Design Mockup</h1>
        <p className="mt-1 text-sm text-muted">
          The whole app, mobile-native. Swap any screen or element in{" "}
          <code className="font-jetbrains text-[12px] text-ink">src/registry.tsx</code> — nothing else changes.
        </p>
      </header>

      {/* phone viewports: full-screen app, no frame */}
      <div className="fixed inset-0 sm:hidden">
        <MobileAppShell platform="ios" />
      </div>

      {/* desktop viewports: framed devices */}
      <main className="mx-auto hidden max-w-5xl flex-wrap items-start justify-center gap-10 sm:flex">
        <DeviceFrame platform="ios" label="iOS — iPhone 16 Pro">
          <MobileAppShell platform="ios" />
        </DeviceFrame>
        <DeviceFrame platform="android" label="Android — Pixel 10">
          <MobileAppShell platform="android" />
        </DeviceFrame>
      </main>

      <footer className="mx-auto mt-8 hidden max-w-4xl text-center text-[11px] text-faint sm:block">
        Scores are mock data. Probability estimate, not an appraisal. Parcel geometry is illustrative.
      </footer>
    </div>
  );
}
