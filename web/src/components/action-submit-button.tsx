"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function ActionSubmitButton({
  children,
  pendingLabel,
  className,
  confirmMessage,
}: {
  children: ReactNode;
  pendingLabel: string;
  className: string;
  confirmMessage?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${className}${pending ? " cursor-wait opacity-60" : ""}`}
      onClick={
        confirmMessage
          ? (event) => {
              if (!confirm(confirmMessage)) event.preventDefault();
            }
          : undefined
      }
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
