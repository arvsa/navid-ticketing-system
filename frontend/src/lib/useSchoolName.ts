import { useSettings } from "@/api/hooks";
import { BRAND_NAME } from "@/lib/labels";

/** The school's name from the settings. Until a root user changes it, the
 * built-in name, in the reader's language. */
const DEFAULT_NAMES = ["Rahe Novin Navid Schools", "Navid Schools"];
export function useSchoolName() {
  const name = useSettings().data?.school_name;
  return !name || DEFAULT_NAMES.includes(name) ? BRAND_NAME : name;
}
