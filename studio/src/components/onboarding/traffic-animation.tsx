import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useResolvedTheme } from '@/hooks/use-resolved-theme';

const STAGE_W = 1244;
const STAGE_H = 394;
const CARD_W = 380;
const CARD_H = 340;
const CARD_TOP = 27;

const pct = (n: number, of: number) => (100 * n) / of;

const CARD_W_PCT = pct(CARD_W, STAGE_W);
const CARD_H_PCT = pct(CARD_H, STAGE_H);
const CARD_TOP_PCT = pct(CARD_TOP, STAGE_H);

const EASE_BACK_OUT: [number, number, number, number] = [0.34, 1.3, 0.64, 1];
const EASE_BACK_POP: [number, number, number, number] = [0.34, 1.8, 0.64, 1];
const EASE_OUT: [number, number, number, number] = [0, 0, 0.3, 1];
const EASE_INOUT: [number, number, number, number] = [0.445, 0.05, 0.55, 0.95];

const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const FONT_SANS = '"Inter", -apple-system, BlinkMacSystemFont, sans-serif';

// --- Timeline ---
const POP_AT = 5.6;
const POP_DUR = 0.85;
const POP_PEAK_T = (5.95 - POP_AT) / POP_DUR;

interface ImgAnim {
  delay: number;
  duration: number;
  times: number[];
  x: string[];
  y: string[];
  scale: number[];
}

interface CardSpec {
  srcKey: string;
  imgWidthPct: number;
  imgLeftPct: number;
  imgTopPct: number;
  badge: string;
  caption: string;
  leftPct: number;
  landAt: number;
  imgAnim?: ImgAnim;
}

const CARDS: CardSpec[] = [
  {
    srcKey: 'composed-graph',
    imgWidthPct: 400,
    imgLeftPct: -73,
    imgTopPct: -45.0,
    badge: '1',
    caption: 'Composed federated graph',
    leftPct: pct(20, STAGE_W),
    landAt: 0.25,
    imgAnim: {
      delay: 0.25,
      duration: 4.2,
      times: [0, 1],
      x: ['0%', '0%'],
      y: ['0%', '0%'],
      scale: [0.9, 0.95],
    },
  },
  {
    srcKey: 'router',
    imgWidthPct: 385,
    imgLeftPct: -277.25,
    imgTopPct: -48.61,
    badge: '2',
    caption: 'Connected Cosmo router',
    leftPct: pct(432, STAGE_W),
    landAt: 1.55,
    imgAnim: {
      delay: 1.55,
      duration: 4.2,
      times: [0, 1],
      x: ['45%', '55%'],
      y: ['0%', '0%'],
      scale: [1, 1],
    },
  },
  {
    srcKey: 'live-metrics',
    imgWidthPct: 385,
    imgLeftPct: -206.0,
    imgTopPct: -144,
    badge: '3',
    caption: 'Live metrics',
    leftPct: pct(844, STAGE_W),
    landAt: 2.85,
    imgAnim: {
      delay: 2.85,
      duration: 5.0,
      times: [0, 1],
      x: ['-16.05%', '0%'],
      y: ['-9.95%', '0%'],
      scale: [1.05, 0.85],
    },
  },
];

interface CardProps {
  spec: CardSpec;
  reduced: boolean;
  theme: 'light' | 'dark';
  onLabelClick?: (key: string) => void;
}

function Card({ spec, reduced, theme, onLabelClick }: CardProps) {
  const src = `/onboarding/${spec.srcKey}-${theme}.png`;
  return (
    <motion.div
      style={{
        position: 'absolute',
        top: `${CARD_TOP_PCT}%`,
        left: `${spec.leftPct}%`,
        width: `${CARD_W_PCT}%`,
        height: `${CARD_H_PCT}%`,
      }}
      initial={reduced ? false : { x: '350%', rotate: -7, scale: 0.86, opacity: 0 }}
      animate={{ x: '0%', rotate: 0, scale: 1, opacity: 1 }}
      transition={reduced ? { duration: 0 } : { delay: spec.landAt, duration: 0.75, ease: EASE_BACK_OUT }}
    >
      <motion.div
        style={{ position: 'relative', width: '100%', height: '100%' }}
        initial={false}
        animate={reduced ? { scale: 1 } : { scale: [1, 1.02, 1] }}
        transition={
          reduced
            ? { duration: 0 }
            : {
                delay: POP_AT,
                duration: POP_DUR,
                times: [0, POP_PEAK_T, 1],
                ease: EASE_INOUT,
              }
        }
      >
        <div
          className={cn(
            'relative h-full w-full overflow-hidden rounded-[14px] bg-white',
            // Two-layer shadow: drop + outer hairline ring (auto-themes via --border).
            'shadow-[0_8px_24px_rgb(0_0_0/0.10),0_0_0_1px_hsl(var(--border))]',
            'dark:shadow-[0_24px_60px_rgb(0_0_0/0.55),0_0_0_1px_hsl(var(--border))]',
          )}
        >
          {spec.imgAnim && !reduced ? (
            <motion.img
              src={src}
              alt=""
              style={{
                position: 'absolute',
                left: `${spec.imgLeftPct}%`,
                top: `${spec.imgTopPct}%`,
                width: `${spec.imgWidthPct}%`,
                height: 'auto',
                maxWidth: 'none',
                userSelect: 'none',
                pointerEvents: 'none',
                transformOrigin: 'top left',
                willChange: 'transform',
              }}
              initial={{ x: spec.imgAnim.x[0], y: spec.imgAnim.y[0], scale: spec.imgAnim.scale[0] }}
              animate={{ x: spec.imgAnim.x, y: spec.imgAnim.y, scale: spec.imgAnim.scale }}
              transition={{
                delay: spec.imgAnim.delay,
                duration: spec.imgAnim.duration,
                times: spec.imgAnim.times,
                ease: 'easeInOut',
              }}
            />
          ) : (
            <img
              src={src}
              alt=""
              style={{
                position: 'absolute',
                left: `${spec.imgLeftPct}%`,
                top: `${spec.imgTopPct}%`,
                width: `${spec.imgWidthPct}%`,
                height: 'auto',
                maxWidth: 'none',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
          )}

          <motion.div
            className={cn(
              'border text-primary',
              // Light: white pill + primary border + soft primary glow
              'border-primary/50 bg-background shadow-[0_2px_8px_hsl(var(--primary)/0.15),0_0_12px_hsl(var(--primary)/0.2)]',
              // Dark: dark pill + primary border + heavier shadow
              'dark:border-primary/55 dark:bg-[hsl(var(--gray-950)/0.92)]',
              'dark:shadow-[0_6px_20px_rgb(0_0_0/0.4),0_0_16px_hsl(var(--primary)/0.28)]',
            )}
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              width: 22,
              height: 22,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              borderRadius: 999,
              fontFamily: FONT_MONO,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1,
            }}
            initial={reduced ? false : { y: -8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={reduced ? { duration: 0 } : { delay: spec.landAt + 0.4, duration: 0.45, ease: EASE_BACK_POP }}
          >
            {spec.badge}
          </motion.div>

          <motion.div
            className={cn(
              'border',
              // Light: white pill + primary border + soft primary glow
              'border-primary/40 bg-background shadow-[0_2px_10px_hsl(var(--primary)/0.10),0_0_14px_hsl(var(--primary)/0.12)]',
              // Dark: dark pill + primary border + heavier shadow
              'dark:border-primary/35 dark:bg-[hsl(var(--gray-950)/0.92)]',
              'dark:shadow-[0_8px_24px_rgb(0_0_0/0.45),0_0_18px_hsl(var(--primary)/0.16)]',
              onLabelClick && 'cursor-pointer',
            )}
            style={{
              position: 'absolute',
              left: 8,
              right: 8,
              bottom: 8,
              padding: '5px 9px',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderRadius: 8,
              textAlign: 'center',
            }}
            onClick={onLabelClick ? () => onLabelClick(spec.srcKey) : undefined}
            initial={reduced ? false : { y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={reduced ? { duration: 0 } : { delay: spec.landAt + 0.5, duration: 0.5, ease: EASE_OUT }}
          >
            <div
              className="text-foreground dark:text-white"
              style={{
                fontFamily: FONT_SANS,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                lineHeight: 1.3,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {spec.caption}
            </div>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function TrafficAnimation({ onLabelClick }: { onLabelClick?: (key: string) => void }) {
  const reduced = !!useReducedMotion();
  const resolvedTheme = useResolvedTheme();
  const theme: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light';

  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-lg', 'border border-border bg-muted/30')}
      style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}
    >
      {CARDS.map((spec, i) => (
        <Card key={i} spec={spec} reduced={reduced} theme={theme} onLabelClick={onLabelClick} />
      ))}
    </div>
  );
}
