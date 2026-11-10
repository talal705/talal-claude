"use client";

// What the 3D scene and the list view share beyond the build itself: which part is selected (so
// each can mark it), and the learner's display choices for the scene.
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type SceneQuality = "low" | "medium" | "high";
export type CameraCommand = "front" | "top" | "side" | "angle" | "fit" | "left" | "right" | "up" | "down" | "in" | "out";

/** Highest device pixel ratio drawn at each quality. Above it the picture gets no sharper, only slower. */
export const PIXEL_RATIO_CAP: Record<SceneQuality, number> = { low: 1, medium: 1.5, high: 2 };

interface SceneState {
  /** The part marked in both views, or null. */
  selectedPartId: string | null;
  /** A cable end chosen in the 3D view (`cableId/endId`), for unplugging or tidying it there; null otherwise. */
  selectedCableEnd: string | null;
  quality: SceneQuality;
  /**
   * True while the current pick was started in the 3D view: the destination list then updates
   * without taking focus, so the page does not scroll away from the places to click.
   */
  pickInScene: boolean;
  /** Counts power-button presses made by clicking the button in the picture, so the page gives the run its own ID. */
  pressSeq: number;
  /** A camera move asked for by a button or a key; `seq` changes on every request. */
  camera: { seq: number; command: CameraCommand } | null;
}

export const sceneStore = createStore<SceneState>()(() => ({ selectedPartId: null, selectedCableEnd: null, quality: "medium", pickInScene: false, pressSeq: 0, camera: null }));

export function useScene<T>(selector: (state: SceneState) => T): T {
  return useStore(sceneStore, selector);
}

export function selectPart(partId: string | null) {
  const state = sceneStore.getState();
  if (state.selectedPartId !== partId || state.selectedCableEnd !== null) sceneStore.setState({ selectedPartId: partId, selectedCableEnd: null });
}

export function moveCamera(command: CameraCommand) {
  sceneStore.setState((state) => ({ camera: { seq: (state.camera?.seq ?? 0) + 1, command } }));
}

export function selectCableEnd(key: string | null) {
  sceneStore.setState({ selectedCableEnd: key, selectedPartId: null });
}
