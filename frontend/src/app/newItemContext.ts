// Kept apart from the provider component so hot reloads during development
// don't create a second context that the open modal never hears from.
import { createContext, useContext } from "react";
import type { IssueType } from "@/api/types";

/** `onlyType` hides the kind picker (the calendar only creates events). */
/** `templateTag`: start from the template with this tag (e.g. "report"). */
export type NewItemOptions = { type?: IssueType; templateTag?: string; date?: string; group?: string; onlyType?: boolean };

export const NewItemContext = createContext<(opts?: NewItemOptions) => void>(() => {});

/** Opens the New item modal, optionally with a kind, date or group chosen. */
export const useNewItem = () => useContext(NewItemContext);
