"use client";

import { useId, type SelectHTMLAttributes } from "react";
import { cn } from "./cn";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children" | "className"> {
  label: string;
  options: SelectOption[];
  className?: string;
}

export function Select({ label, options, className, id, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={selectId} className="text-overline font-semibold text-text-secondary">
        {label}
      </label>
      <div className="relative">
        <select
          {...rest}
          id={selectId}
          className="h-10 w-full appearance-none rounded-sm border border-hairline bg-canvas pl-3 pr-8 text-body text-text"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-caption text-text-secondary"
        >
          ▾
        </span>
      </div>
    </div>
  );
}
