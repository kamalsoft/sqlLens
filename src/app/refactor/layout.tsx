import { FeatureOff } from "@/components/FeatureOff";
import { readAppConfig } from "@/lib/app-config";

// Read the setting on every request, so switching it in Settings takes effect without a rebuild.
export const dynamic = "force-dynamic";

export default async function RefactorLayout({ children }: { children: React.ReactNode }) {
  const config = await readAppConfig();
  return config.showRefactor ? children : <FeatureOff name="Refactor" setting="Show Refactor" />;
}
