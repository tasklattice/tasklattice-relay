import type { ReactNode } from "react";
import { PageHeader } from "./page-header";

/** The settings navigation already supplies scope; the page names the active task. */
export function SettingsSection({
  action,
  children,
  description,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="min-w-0 space-y-6">
      <PageHeader title={title} description={description} actions={action} />
      <div className="min-w-0">{children}</div>
    </section>
  );
}
