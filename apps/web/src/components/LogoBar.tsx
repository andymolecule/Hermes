export function LogoBar() {
    return (
        <div className="grid grid-cols-4 border-t border-black bg-surface-base text-black font-semibold uppercase font-mono text-sm">
            <div className="py-4 border-r border-black flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity">Molecule</div>
            <div className="py-4 border-r border-black flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity">Bio Phlmd</div>
            <div className="py-4 border-r border-black flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity">BioS</div>
            <div className="py-4 flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity">Beach Science</div>
        </div>
    );
}
