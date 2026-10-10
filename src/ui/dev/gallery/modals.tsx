/** Gallery entries: modals. */
import type { GalleryEntry } from "../galleryTypes";
import { PauseOverlay } from "../../game/PauseOverlay";

export const entries: GalleryEntry[] = [
  { id: "PauseOverlay", group: "modal", render: () => <PauseOverlay accentColor="#00ff88" zoomStuck onResume={() => {}} /> },
];
