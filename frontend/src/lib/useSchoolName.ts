import { useSettings } from "@/api/hooks";
import { BRAND_NAME } from "@/lib/labels";

/** The school's name from the settings. Until a super admin changes it, the
 * built-in name, in the reader's language. */
export function useSchoolName() {
  const name = useSettings().data?.school_name;
  return !name || name === "Navid Schools" ? BRAND_NAME : name;
}
