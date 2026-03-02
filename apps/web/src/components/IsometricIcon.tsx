import { ReactNode } from "react";

export function IsometricIcon({ children, className = "" }: { children: ReactNode, className?: string }) {
    return (
        <div className={`relative inline-flex flex-col items-center justify-center ${className}`}>
            {/* Flat isometric shadow underlying the icon */}
            <div
                className="absolute -bottom-1 w-16 h-4 bg-black/15 rounded-full blur-[4px]"
                style={{ transform: 'scaleY(0.4) skewX(-20deg)' }}
                aria-hidden="true"
            />
            <div className="relative z-10 transition-transform duration-200">
                {children}
            </div>
        </div>
    );
}
