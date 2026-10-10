export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Mobile number is required.");

  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) {
    digits = `+${digits.slice(2)}`;
  }

  if (digits.startsWith("+")) {
    const intlDigits = digits.slice(1).replace(/\D/g, "");
    if (intlDigits.length < 8 || intlDigits.length > 15) {
      throw new Error("Enter a valid international phone number.");
    }
    return `+${intlDigits}`;
  }

  const plainDigits = digits.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(plainDigits)) {
    return `+91${plainDigits}`;
  }
  if (/^91[6-9]\d{9}$/.test(plainDigits)) {
    return `+${plainDigits}`;
  }
  if (plainDigits.length >= 8 && plainDigits.length <= 15) {
    return `+${plainDigits}`;
  }

  throw new Error("Enter a valid mobile number.");
}

export function phoneForWhatsApp(normalizedMobile: string): string | null {
  try {
    return normalizePhone(normalizedMobile).replace(/^\+/, "");
  } catch {
    return null;
  }
}
