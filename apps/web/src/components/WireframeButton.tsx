import { ButtonHTMLAttributes, forwardRef } from "react";

interface WireframeButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary";
}

export const WireframeButton = forwardRef<HTMLButtonElement, WireframeButtonProps>(
    ({ className = "", variant = "primary", ...props }, ref) => {
        const baseClass = variant === "secondary" ? "btn-secondary" : "btn-primary";

        return (
            <button
                ref={ref}
                className={`inline-flex items-center justify-center px-6 py-2.5 font-semibold text-sm transition-all duration-200 ${baseClass} ${className}`}
                {...props}
            />
        );
    }
);
WireframeButton.displayName = "WireframeButton";
