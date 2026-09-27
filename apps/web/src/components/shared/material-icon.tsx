/** A Material Symbols glyph by name, matching the Stitch mockups' iconography exactly instead of the app's usual lucide set. */
export function Icon({
  name,
  className = "text-[20px]",
}: {
  name: string;
  className?: string;
}) {
  return (
    <span className={`material-symbols-outlined ${className}`}>{name}</span>
  );
}
