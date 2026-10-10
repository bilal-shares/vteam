export function rupeesToPaise(value: string | number): number {
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error("Amount must be a valid INR value with up to two decimals.");
  }
  const [rupees, paise = ""] = raw.split(".");
  return Number(rupees) * 100 + Number(paise.padEnd(2, "0"));
}

export function paiseToRupees(value: number): string {
  return (value / 100).toFixed(2);
}

export function formatInr(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: value % 100 === 0 ? 0 : 2
  }).format(value / 100);
}

export function calculatePaymentStatus(pricePaise: number, paidPaise: number): "paid" | "partial" | "unpaid" {
  if (paidPaise <= 0) return "unpaid";
  if (paidPaise >= pricePaise) return "paid";
  return "partial";
}
