import { create } from "zustand";

interface UiState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
