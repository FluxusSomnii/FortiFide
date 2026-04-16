import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PatternCategory } from "@fides/pattern-library";

interface DisplayState {
  categoryVisibility: Record<PatternCategory, boolean>;
  confidenceFloor: number;

  setCategoryVisible: (category: PatternCategory, visible: boolean) => void;
  setConfidenceFloor: (floor: number) => void;
}

const defaultVisibility: Record<PatternCategory, boolean> = {
  manipulation: true,
  authority: true,
  fallacy: true,
  emotional: true,
  framing: true,
  narrative: true,
  "cognitive-bias": true,
};

export const useDisplayStore = create<DisplayState>()(
  persist(
    (set) => ({
      categoryVisibility: { ...defaultVisibility },
      confidenceFloor: 0.4,

      setCategoryVisible: (category, visible) =>
        set((state) => ({
          categoryVisibility: {
            ...state.categoryVisibility,
            [category]: visible,
          },
        })),

      setConfidenceFloor: (floor) => set({ confidenceFloor: floor }),
    }),
    {
      name: "fides-display-preferences",
    },
  ),
);
