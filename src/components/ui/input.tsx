import * as React from "react"
import { cn } from "@/lib/utils"

const NATIVE_PICKERS = new Set(["date", "datetime-local", "month", "week", "time"])

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    const isNativePicker = type ? NATIVE_PICKERS.has(type) : false
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-base file:font-medium",
          // Native picker types (month/date/datetime-local/week/time) ship with
          // browser-injected chrome that ignores `h-9` / `w-full`, producing
          // visibly taller and wider controls than sibling SelectTriggers.
          // `appearance-none` strips that chrome; `min-w-0 box-border` lock
          // the box to the Tailwind sizing tokens. `[color-scheme:light]`
          // keeps the picker popup theme-aligned.
          isNativePicker && "[color-scheme:light] appearance-none min-w-0 box-border leading-none",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
