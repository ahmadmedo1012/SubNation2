import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
}

export function Logo({ size = "md", showText = true, className }: LogoProps) {
  const iconSizes = { sm: "w-7 h-7", md: "w-9 h-9", lg: "w-14 h-14" };
  const textSizes = { sm: "text-base", md: "text-lg", lg: "text-2xl" };
  const innerSizes = { sm: "text-xs", md: "text-sm", lg: "text-xl" };

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className={cn(
        "rounded-xl bg-primary flex items-center justify-center shrink-0 shadow-lg shadow-primary/25",
        iconSizes[size]
      )}>
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={cn("w-5 h-5", size === "sm" && "w-4 h-4", size === "lg" && "w-9 h-9")}>
          <path d="M8 10C8 8.9 8.9 8 10 8h5c3.3 0 6 2.7 6 6s-2.7 6-6 6H8V10z" fill="white" fillOpacity="0.95"/>
          <path d="M16 20c0-1.1.9-2 2-2h2c2.2 0 4 1.8 4 4s-1.8 4-4 4h-4V20z" fill="white" fillOpacity="0.6"/>
          <circle cx="10" cy="22" r="2" fill="white" fillOpacity="0.4"/>
        </svg>
      </div>
      {showText && (
        <span className={cn("font-black tracking-tight", textSizes[size])}>
          Sub<span className="text-primary">Nation</span>
        </span>
      )}
    </div>
  );
}
