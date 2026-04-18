"use client";

import { motion, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/utils";

const SIZE_PX = { sm: 36, md: 44 } as const;

type LuckyNekoMascotProps = {
  className?: string;
  /** Header chip vs. chat avatar */
  variant?: "hero" | "avatar";
  /** Play entrance “happy owner arrived” motion */
  celebrateOnMount?: boolean;
};

/**
 * Inline vector lucky cat (maneki-neko) — no external assets.
 */
export function LuckyNekoMascot({
  className,
  variant = "hero",
  celebrateOnMount = true,
}: LuckyNekoMascotProps) {
  const reduceMotion = useReducedMotion();
  const celebrate = celebrateOnMount && !reduceMotion;
  const px = variant === "avatar" ? SIZE_PX.sm : SIZE_PX.md;

  return (
    <motion.div
      className={cn("relative shrink-0 select-none", className)}
      style={{ width: px, height: px }}
      initial={celebrate ? { scale: 0.82, y: 6 } : undefined}
      animate={
        celebrate
          ? {
              scale: [0.82, 1.06, 0.98, 1],
              y: [6, -5, 0, 0],
            }
          : { scale: 1, y: 0 }
      }
      transition={
        celebrate
          ? { duration: 0.75, times: [0, 0.35, 0.72, 1], ease: "easeOut" }
          : { duration: 0.2 }
      }
      aria-hidden
    >
      <motion.svg
        viewBox="0 0 100 100"
        className="h-full w-full overflow-visible"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="neko-face" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fff7ed" />
            <stop offset="100%" stopColor="#fde68a" />
          </linearGradient>
          <linearGradient id="neko-ear" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fca5a5" />
            <stop offset="100%" stopColor="#f87171" />
          </linearGradient>
        </defs>

        {/* ears */}
        <path
          d="M28 38 L22 14 L42 26 Z"
          fill="url(#neko-ear)"
          stroke="#b91c1c"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M72 38 L78 14 L58 26 Z"
          fill="url(#neko-ear)"
          stroke="#b91c1c"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />

        {/* head */}
        <ellipse cx="50" cy="48" rx="30" ry="27" fill="url(#neko-face)" stroke="#ca8a04" strokeWidth="1.4" />

        {/* happy eyes */}
        <path
          d="M36 46 Q40 42 44 46"
          stroke="#422006"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M56 46 Q60 42 64 46"
          stroke="#422006"
          strokeWidth="2.2"
          strokeLinecap="round"
        />

        {/* nose + mouth */}
        <path d="M50 52 L47 56 H53 Z" fill="#fb7185" />
        <path
          d="M50 56 Q44 60 40 58 M50 56 Q56 60 60 58"
          stroke="#422006"
          strokeWidth="1.5"
          strokeLinecap="round"
        />

        {/* whiskers */}
        <g stroke="#78716c" strokeWidth="1.2" strokeLinecap="round" opacity="0.55">
          <path d="M12 48 H26" />
          <path d="M14 56 H26" />
          <path d="M74 48 H88" />
          <path d="M74 56 H86" />
        </g>

        {/* collar + bell */}
        <path
          d="M28 68 Q50 76 72 68"
          stroke="#dc2626"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <circle cx="50" cy="72" r="7" fill="#facc15" stroke="#ca8a04" strokeWidth="1.2" />
        <line x1="50" y1="69" x2="50" y2="75" stroke="#a16207" strokeWidth="1" strokeLinecap="round" />
        <circle cx="50" cy="72" r="1.6" fill="#a16207" />

        {/* body */}
        <ellipse cx="50" cy="86" rx="22" ry="14" fill="#fef9c3" stroke="#ca8a04" strokeWidth="1.2" />

        {/* coin */}
        <circle cx="34" cy="84" r="6" fill="#fde047" stroke="#ca8a04" strokeWidth="1" />
        <text
          x="34"
          y="87"
          textAnchor="middle"
          fontSize="7"
          fontWeight="700"
          fill="#854d0e"
          fontFamily="system-ui, sans-serif"
        >
          ¥
        </text>

        {/* waving paw */}
        <motion.g
          style={{ transformOrigin: "72px 62px" }}
          animate={celebrate ? { rotate: [0, 16, -4, 14, 0] } : { rotate: 0 }}
          transition={
            celebrate
              ? { duration: 0.85, delay: 0.12, ease: "easeInOut" }
              : { duration: 0.2 }
          }
        >
          <ellipse cx="72" cy="62" rx="9" ry="11" fill="url(#neko-face)" stroke="#ca8a04" strokeWidth="1.2" />
          <path
            d="M66 56 Q72 52 78 56"
            stroke="#422006"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </motion.g>
      </motion.svg>

      {variant === "hero" && celebrate ? (
        <motion.span
          className="pointer-events-none absolute -right-1 -top-1 text-lg"
          initial={{ opacity: 0, scale: 0.5, y: 4 }}
          animate={{ opacity: [0, 1, 1, 0], scale: [0.5, 1.1, 1, 0.9], y: [4, -2, -6, -10] }}
          transition={{ duration: 1.1, delay: 0.05, ease: "easeOut" }}
        >
          ✨
        </motion.span>
      ) : null}
    </motion.div>
  );
}

export function LuckyNekoAvatar({ className }: { className?: string }) {
  return (
    <LuckyNekoMascot
      variant="avatar"
      celebrateOnMount={false}
      className={cn(className)}
    />
  );
}
