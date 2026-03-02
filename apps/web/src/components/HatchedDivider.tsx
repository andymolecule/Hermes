export function HatchedDivider({ className = "" }: { className?: string }) {
    return <div className={`hatched-divider ${className}`} aria-hidden="true" />;
}
