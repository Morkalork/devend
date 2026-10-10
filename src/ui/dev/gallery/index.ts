/** Every gallery entry, from the per-area files beside this one. */
import type { GalleryEntry } from "../galleryTypes";
import { entries as play } from "./play";
import { entries as board } from "./board";
import { entries as modals } from "./modals";
import { entries as between } from "./between";
import { entries as meta } from "./meta";

export const galleryEntries: GalleryEntry[] = [...play, ...board, ...modals, ...between, ...meta];
