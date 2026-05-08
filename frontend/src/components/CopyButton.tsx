import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  text: string;
  label?: string;
  size?: "sm" | "md";
}

export function CopyButton({ text, label = "نسخ", size = "sm" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (size === "md") {
    return (
      <button
        onClick={copy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/18 text-primary text-sm font-bold transition-all active:scale-95 shrink-0"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? "تم!" : label}
      </button>
    );
  }

  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 hover:bg-primary/18 text-primary text-xs font-bold transition-all active:scale-95 shrink-0"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "تم" : label}
    </button>
  );
}
