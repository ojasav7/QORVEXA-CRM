import { Modal } from "./ui";
import { AlertTriangle, Trash2 } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: "danger" | "warning";
};

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  variant = "danger",
}: Props) {
  const colors =
    variant === "danger"
      ? "bg-rose-500 hover:bg-rose-600 text-white"
      : "bg-amber-500 hover:bg-amber-600 text-white";

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-500/15">
            <AlertTriangle className="size-5 text-rose-400" />
          </div>
          <p className="text-sm leading-relaxed text-slate-300">{message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${colors}`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {variant === "danger" && <Trash2 className="size-4" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
