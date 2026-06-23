import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { OnboardingStatus } from './status-icon';

// --- Layout ---
const VB_W = 700;
const VB_H = 200;
const MID_Y = VB_H / 2;
const PAD_X = 20;
const LINE_W = VB_W - PAD_X * 2;

// --- Colors ---
const MUTED = 'hsl(var(--muted-foreground))';
const PRIMARY = 'hsl(var(--primary))';
const DESTRUCTIVE = 'hsl(var(--destructive))';

// --- Paths ---
const NUM_POINTS = 12;

function buildPoints(flat: boolean): [number, number][] {
  const points: [number, number][] = [];
  const startX = PAD_X;
  const endX = PAD_X + LINE_W;
  const cx = startX + LINE_W / 2;

  if (flat) {
    for (let i = 0; i < NUM_POINTS; i++) {
      points.push([startX + (i * LINE_W) / (NUM_POINTS - 1), MID_Y]);
    }
  } else {
    points.push([startX, MID_Y]);
    points.push([cx - 60, MID_Y]);
    points.push([cx - 30, MID_Y]);
    points.push([cx - 18, MID_Y - 14]);
    points.push([cx - 8, MID_Y]);
    points.push([cx, MID_Y - 70]);
    points.push([cx + 8, MID_Y + 30]);
    points.push([cx + 18, MID_Y]);
    points.push([cx + 32, MID_Y - 18]);
    points.push([cx + 50, MID_Y]);
    points.push([cx + 80, MID_Y]);
    points.push([endX, MID_Y]);
  }

  return points;
}

function pointsToPath(points: [number, number][]): string {
  const [first, ...rest] = points;
  return `M ${first[0]} ${first[1]} ` + rest.map(([x, y]) => `L ${x} ${y}`).join(' ');
}

/** Normalized cumulative distance for each point (0→1) */
function cumulativeProgress(points: [number, number][]): number[] {
  let total = 0;
  const dists = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    total += Math.sqrt(dx * dx + dy * dy);
    dists.push(total);
  }
  return dists.map((d) => d / total);
}

const FLAT_POINTS = buildPoints(true);
const BEAT_POINTS = buildPoints(false);
const FLAT_PATH = pointsToPath(FLAT_POINTS);
const BEAT_PATH = pointsToPath(BEAT_POINTS);
const FLAT_PROGRESS = cumulativeProgress(FLAT_POINTS);
const BEAT_PROGRESS = cumulativeProgress(BEAT_POINTS);

// --- Animation timing ---
const SCAN_DURATION = 3;
const ALIVE_DURATION = 2.2;
// Beam trail length as fraction of path
const SCAN_TRAIL = 0.35;
const ALIVE_TRAIL = 0.45;

type MonitorState = 'scanning' | 'alive' | 'failed';

function statusToState(status: OnboardingStatus): MonitorState {
  switch (status) {
    case 'pending':
      return 'scanning';
    case 'ok':
      return 'alive';
    case 'fail':
    case 'error':
      return 'failed';
  }
}

export const MetricsMonitor = ({ status }: { status: OnboardingStatus }) => {
  const state = statusToState(status);

  const isAlive = state === 'alive';
  const isFailed = state === 'failed';
  const shouldAnimate = !isFailed;

  const points = isAlive ? BEAT_POINTS : FLAT_POINTS;
  const path = isAlive ? BEAT_PATH : FLAT_PATH;
  const progress = isAlive ? BEAT_PROGRESS : FLAT_PROGRESS;
  const color = isAlive ? PRIMARY : isFailed ? DESTRUCTIVE : MUTED;

  const trail = isAlive ? ALIVE_TRAIL : SCAN_TRAIL;
  const drawDuration = isAlive ? ALIVE_DURATION : SCAN_DURATION;
  const drawFraction = 1 / (1 + trail); // portion of cycle where dot moves (rest is tail exit)
  const cycleDuration = drawDuration;

  // Dot keyframes synced to stroke reveal
  const dotKeyframes = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    const times: number[] = [];

    // Dot goes 0→1 in drawFraction, holds at end while tail exits
    for (let i = 0; i < points.length; i++) {
      xs.push(points[i][0]);
      ys.push(points[i][1]);
      times.push(progress[i] * drawFraction);
    }
    // Hold at end while tail exits
    xs.push(points[points.length - 1][0]);
    ys.push(points[points.length - 1][1]);
    times.push(1);

    // Gradient x1 (trailing edge, transparent) and x2 (leading edge, opaque)
    const trailPx = trail * LINE_W;
    const gx1: number[] = [];
    const gx2: number[] = [];
    for (let i = 0; i < xs.length; i++) {
      gx2.push(xs[i]);
      gx1.push(xs[i] - trailPx);
    }

    return { xs, ys, times, gx1, gx2 };
  }, [points, progress, drawFraction, trail]);
  const lineOpacity = isAlive ? 1 : 0.4;

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-muted/30">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full">
        <defs>
          <filter id="beat-glow" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feFlood floodColor={PRIMARY} floodOpacity="0.4" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Beam gradient: transparent at trailing edge → solid at leading edge */}
          <motion.linearGradient
            id="beam-grad"
            gradientUnits="userSpaceOnUse"
            y1={MID_Y}
            y2={MID_Y}
            animate={{
              x1: dotKeyframes.gx1,
              x2: dotKeyframes.gx2,
            }}
            transition={{
              x1: {
                duration: cycleDuration,
                times: dotKeyframes.times,
                ease: 'linear',
                repeat: Infinity,
              },
              x2: {
                duration: cycleDuration,
                times: dotKeyframes.times,
                ease: 'linear',
                repeat: Infinity,
              },
            }}
          >
            <stop offset="0%" stopColor={color} stopOpacity={0} />
            <stop offset="100%" stopColor={color} stopOpacity={lineOpacity} />
          </motion.linearGradient>
        </defs>

        {/* Background grid lines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD_X}
            y1={VB_H * f}
            x2={PAD_X + LINE_W}
            y2={VB_H * f}
            stroke={MUTED}
            strokeOpacity={0.08}
            strokeWidth={1}
          />
        ))}

        {shouldAnimate ? (
          <g key={`anim-${state}`}>
            {/* Beam trail sweeps L→R with gradient fade */}
            <motion.path
              d={path}
              fill="none"
              stroke="url(#beam-grad)"
              strokeWidth={isAlive ? 2.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              style={{ strokeDasharray: `${trail} 1` }}
              filter={isAlive ? 'url(#beat-glow)' : undefined}
              animate={{
                strokeDashoffset: [trail, -1],
              }}
              transition={{
                duration: cycleDuration,
                ease: 'linear',
                repeat: Infinity,
              }}
            />

            {/* Leading dot */}
            <motion.circle
              r={isAlive ? 5 : 4}
              fill={color}
              filter={isAlive ? 'url(#beat-glow)' : undefined}
              animate={{
                cx: dotKeyframes.xs,
                cy: dotKeyframes.ys,
                opacity: isAlive
                  ? [...Array(points.length).fill(1), 0]
                  : points
                      .map((_, i) => {
                        const p = progress[i];
                        if (p < 0.65) return 0.7;
                        return 0.7 * (1 - (p - 0.65) / 0.35);
                      })
                      .concat([0]),
              }}
              transition={{
                cx: {
                  duration: cycleDuration,
                  times: dotKeyframes.times,
                  ease: 'linear',
                  repeat: Infinity,
                },
                cy: {
                  duration: cycleDuration,
                  times: dotKeyframes.times,
                  ease: 'linear',
                  repeat: Infinity,
                },
                opacity: {
                  duration: cycleDuration,
                  times: dotKeyframes.times,
                  ease: 'linear',
                  repeat: Infinity,
                },
              }}
            />

            {/* Pulsing ring radiating from dot (alive only) */}
            {isAlive && (
              <motion.circle
                r={5}
                fill="none"
                stroke={PRIMARY}
                strokeWidth={2}
                animate={{
                  cx: dotKeyframes.xs,
                  cy: dotKeyframes.ys,
                  r: [5, 16],
                  opacity: [0.6, 0],
                  strokeWidth: [2, 0.5],
                }}
                transition={{
                  cx: {
                    duration: cycleDuration,
                    times: dotKeyframes.times,
                    ease: 'linear',
                    repeat: Infinity,
                  },
                  cy: {
                    duration: cycleDuration,
                    times: dotKeyframes.times,
                    ease: 'linear',
                    repeat: Infinity,
                  },
                  r: {
                    duration: 1,
                    ease: 'easeOut',
                    repeat: Infinity,
                  },
                  opacity: {
                    duration: 1,
                    ease: 'easeOut',
                    repeat: Infinity,
                  },
                  strokeWidth: {
                    duration: 1,
                    ease: 'easeOut',
                    repeat: Infinity,
                  },
                }}
              />
            )}
          </g>
        ) : (
          <path d={FLAT_PATH} fill="none" stroke={DESTRUCTIVE} strokeWidth={1.5} strokeLinecap="round" opacity={0.4} />
        )}
      </svg>
    </div>
  );
};
