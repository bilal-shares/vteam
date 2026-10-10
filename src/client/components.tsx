import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";

export function Button({
  children,
  variant = "primary",
  type = "button",
  onClick,
  disabled,
  className = ""
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button type={type} className={`btn ${variant} ${className}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function StatusBadge({ status }: { status?: string | null }) {
  const value = status ?? "unknown";
  return <span className={`badge ${value}`}>{value.replace("_", " ")}</span>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <AlertTriangle size={24} />
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading">
      <Loader2 className="spin" size={18} />
      {label}
    </div>
  );
}

export function Toast({
  message,
  tone,
  onClose
}: {
  message: string;
  tone: "success" | "error";
  onClose: () => void;
}) {
  return (
    <div className={`toast ${tone}`}>
      {tone === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}

export function Dialog({
  title,
  open,
  onClose,
  children
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="dialog-header">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
