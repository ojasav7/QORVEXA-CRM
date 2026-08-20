import { Modal, Kbd } from "./ui";

type Shortcut = {
  keys: string[];
  label: string;
  category: string;
};

const SHORTCUTS: Shortcut[] = [
  // Navigation
  { keys: ["/"], label: "Open search & command palette", category: "Navigation" },
  { keys: ["⌘", "K"], label: "Toggle command palette (macOS)", category: "Navigation" },
  { keys: ["Ctrl", "K"], label: "Toggle command palette (Windows/Linux)", category: "Navigation" },
  { keys: ["?"], label: "Show keyboard shortcuts", category: "Navigation" },
  { keys: ["Esc"], label: "Close modal / drawer / palette", category: "Navigation" },

  // Quick create
  { keys: ["N"], label: "Create new lead", category: "Quick create" },
  { keys: ["D"], label: "Create new deal", category: "Quick create" },
  { keys: ["T"], label: "Create new task", category: "Quick create" },

  // Command palette
  { keys: ["↑", "↓"], label: "Navigate results", category: "Command palette" },
  { keys: ["Enter"], label: "Select / open item", category: "Command palette" },
  { keys: ["Tab"], label: "Cycle focus within palette", category: "Command palette" },

  // Modal & drawer
  { keys: ["Esc"], label: "Close modal / drawer", category: "Modal & drawer" },
  { keys: ["Tab"], label: "Cycle focus within modal", category: "Modal & drawer" },
  { keys: ["Shift", "Tab"], label: "Cycle focus backwards", category: "Modal & drawer" },
];

export default function KeyboardShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Group shortcuts by category
  const grouped = SHORTCUTS.reduce<Record<string, Shortcut[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="lg">
      <div className="grid gap-6 sm:grid-cols-2">
        {Object.entries(grouped).map(([category, shortcuts]) => (
          <div key={category}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              {category}
            </h3>
            <div className="space-y-2">
              {shortcuts.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="text-sm text-slate-300">{s.label}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    {s.keys.map((k, j) => (
                      <span key={j} className="flex items-center gap-1">
                        {j > 0 && (
                          <span className="text-[10px] text-slate-600">+</span>
                        )}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 border-t border-[var(--border-subtle)] pt-4 text-center text-xs text-slate-500">
        Shortcuts are disabled while typing in form fields or when a modal is open.
      </div>
    </Modal>
  );
}
