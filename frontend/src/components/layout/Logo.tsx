import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
}

export function Logo({ size = "md", showText = true, className }: LogoProps) {
  const iconSizes = { sm: "w-7 h-7", md: "w-9 h-9", lg: "w-14 h-14" };
  const svgSizes = { sm: "w-4 h-4", md: "w-5 h-5", lg: "w-8 h-8" };
  const textSizes = { sm: "text-base", md: "text-xl", lg: "text-3xl" };

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {/* Shield icon — matches the actual SubNation brand mark */}
      <div
        className={cn(
          "rounded-xl bg-primary flex items-center justify-center shrink-0 shadow-lg shadow-primary/30",
          iconSizes[size],
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={svgSizes[size]}
        >
          {/* Shield outline */}
          <path
            d="M12 2L4 5.5v6c0 4.5 3.4 8.7 8 9.7 4.6-1 8-5.2 8-9.7v-6L12 2z"
            fill="white"
            fillOpacity="0.15"
            stroke="white"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          {/* Play triangle */}
          <path d="M10 9l5 3-5 3V9z" fill="white" fillOpacity="0.95" />
          {/* Orbit arc / cursor dot */}
          <circle cx="16.5" cy="14.5" r="1.2" fill="white" fillOpacity="0.7" />
          <path
            d="M9 14.5 Q12.5 17 16.5 14.5"
            stroke="white"
            strokeWidth="1.2"
            strokeOpacity="0.6"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {showText && (
        <span className={cn("font-black tracking-tight leading-none", textSizes[size])}>
          Sub<span className="text-primary-text">Nation</span>
        </span>
      )}
    </div>
  );
}
