export function LogoBar() {
    return (
        <div className="grid grid-cols-4 bg-[var(--surface-container-low)] text-[var(--text-primary)] font-semibold uppercase font-mono text-sm">
            <div className="py-4 bg-[var(--surface-container-lowest)] flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity">Molecule</div>
            <div className="py-4 bg-[var(--surface-container-lowest)] flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity">Bio Phlmd</div>
            <div className="py-4 bg-[var(--surface-container-lowest)] flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity">BioS</div>
            <div className="py-4 bg-[var(--surface-container-lowest)] flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity">Beach Science</div>
        </div>
    );
}
