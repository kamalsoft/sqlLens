import Link from "next/link";

/** UX-A: shown instead of a screen that is turned off in Settings. */
export function FeatureOff({ name, setting }: { name: string; setting: string }) {
  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">Turned off</p>
          <h2 className="page-title">{name}</h2>
        </div>
      </header>
      <section className="panel panel-card">
        <p className="analysis-note">
          {name} is turned off. To use it, open <Link href="/settings" className="text-link">Settings</Link>, switch on
          &ldquo;{setting}&rdquo; under Features, and save.
        </p>
      </section>
    </>
  );
}
