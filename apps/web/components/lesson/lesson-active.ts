"use client";

// Whether a lesson is open in the workspace. While one is, the lesson is the tutor's only topic
// source: the labs do not hand their own engine findings to the tutor, so a fault exercise or a
// challenge cannot be given away by the engine's explanations.
import { createStore } from "zustand/vanilla";

export const lessonActive = createStore<{ open: boolean }>()(() => ({ open: false }));
