import { motion } from 'framer-motion';
import { Logo } from '../logo';

// --- SVG layout ---
const VB_W = 700;
const VB_H = 220;
const CARD_R = 8;
const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
const EASE_OUT: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];
const ease = (duration: number, delay = 0) => ({ duration, delay, ease: EASE_OUT });

// Node boxes
const CLIENT = { x: 30, y: 90, w: 110, h: 40 };
const ROUTER = { x: 280, y: 80, w: 140, h: 60 };
const PRODUCTS = { x: 560, y: 30, w: 110, h: 40 };
const REVIEWS = { x: 560, y: 150, w: 110, h: 40 };

// Edge endpoints (right/left midpoints of the boxes)
const CLIENT_R: [number, number] = [CLIENT.x + CLIENT.w, CLIENT.y + CLIENT.h / 2];
const ROUTER_L: [number, number] = [ROUTER.x, ROUTER.y + ROUTER.h / 2];
const ROUTER_R: [number, number] = [ROUTER.x + ROUTER.w, ROUTER.y + ROUTER.h / 2];
const PRODUCTS_L: [number, number] = [PRODUCTS.x, PRODUCTS.y + PRODUCTS.h / 2];
const REVIEWS_L: [number, number] = [REVIEWS.x, REVIEWS.y + REVIEWS.h / 2];

const edgePath = (a: [number, number], b: [number, number]) => `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`;

const EDGE_CLIENT_ROUTER = edgePath(CLIENT_R, ROUTER_L);
const EDGE_ROUTER_PRODUCTS = edgePath(ROUTER_R, PRODUCTS_L);
const EDGE_ROUTER_REVIEWS = edgePath(ROUTER_R, REVIEWS_L);

// --- Timing (all relative to mount, seconds) ---
const T_NODES = 0;
const T_LABELS = 0.6;
const T_EDGES = 1.0;
const T_REQ = 1.3;
const T_FANOUT = 1.8;
const T_RESOLVE = 2.4;
const T_FANIN = 2.7;
const T_MERGED = 3.3;
const T_SETTLE = 3.8;

const REQ_DUR = 0.5;
const FANOUT_DUR = 0.6;
const PULSE_DUR = 0.6;

// --- Node ---

interface NodeProps {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  delay: number;
  clipId: string;
  showLogo?: boolean;
  large?: boolean;
}

function Node({ x, y, w, h, label, delay, clipId, showLogo, large }: NodeProps) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const fontSize = large ? 12 : 11;
  const textX = x + (showLogo ? 32 : 14);
  const textY = y + h / 2 + 1;

  return (
    <g>
      <defs>
        <clipPath id={`${clipId}-wipe`}>
          <motion.rect
            x={x}
            y={y}
            height={h}
            initial={{ width: 0 }}
            animate={{ width: w }}
            transition={ease(0.45, T_LABELS + delay)}
          />
        </clipPath>
      </defs>

      {/* Outer box — zoom from center */}
      <motion.rect
        initial={{ x: cx, y: cy, width: 0, height: 0, rx: CARD_R }}
        animate={{ x, y, width: w, height: h, rx: CARD_R }}
        transition={ease(0.5, T_NODES + delay)}
        fill="hsl(var(--card))"
        stroke={large ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
        strokeWidth={large ? 1.5 : 1}
      />

      {/* Label (+ optional logo) clipped for wipe-in */}
      <g clipPath={`url(#${clipId}-wipe)`}>
        {showLogo && (
          <foreignObject x={x + 12} y={y + h / 2 - 7} width={14} height={14}>
            <div style={{ color: 'hsl(var(--primary))', lineHeight: 0 }}>
              <Logo width={14} height={14} />
            </div>
          </foreignObject>
        )}
        <text
          x={textX}
          y={textY}
          dominantBaseline="central"
          fill={large ? 'hsl(var(--primary))' : 'hsl(var(--foreground))'}
          fontSize={fontSize}
          fontWeight={600}
          fontFamily={MONO_FONT}
          letterSpacing="0.05em"
        >
          {label}
        </text>
      </g>
    </g>
  );
}

// --- Edge ---

function Edge({ d }: { d: string }) {
  return (
    <motion.path
      d={d}
      fill="none"
      strokeWidth={1.5}
      strokeDasharray="6 5"
      strokeLinecap="round"
      initial={{ opacity: 0, stroke: 'hsl(var(--muted-foreground))' }}
      animate={{
        opacity: [0, 0.35, 0.35, 0.55],
        stroke: [
          'hsl(var(--muted-foreground))',
          'hsl(var(--muted-foreground))',
          'hsl(var(--muted-foreground))',
          'hsl(var(--primary))',
        ],
      }}
      transition={{
        duration: T_SETTLE + 0.4 - T_EDGES,
        delay: T_EDGES,
        times: [0, 0.12, (T_SETTLE - T_EDGES) / (T_SETTLE + 0.4 - T_EDGES), 1],
        ease: 'linear',
      }}
    />
  );
}

// --- Packet ---

interface PacketProps {
  from: [number, number];
  to: [number, number];
  delay: number;
  duration: number;
}

function Packet({ from, to, delay, duration }: PacketProps) {
  return (
    <motion.circle
      r={4}
      fill="hsl(var(--primary))"
      filter="url(#packet-glow)"
      initial={{ cx: from[0], cy: from[1], opacity: 0 }}
      animate={{
        cx: [from[0], to[0]],
        cy: [from[1], to[1]],
        opacity: [0, 1, 1, 0],
      }}
      transition={{
        cx: { duration, delay, ease: 'linear' },
        cy: { duration, delay, ease: 'linear' },
        opacity: { duration, delay, times: [0, 0.1, 0.85, 1] },
      }}
    />
  );
}

// --- Resolve pulse ---

function ResolvePulse({ cx, cy, delay }: { cx: number; cy: number; delay: number }) {
  return (
    <motion.circle
      cx={cx}
      cy={cy}
      fill="none"
      stroke="hsl(var(--primary))"
      initial={{ r: 4, opacity: 0, strokeWidth: 2 }}
      animate={{ r: [4, 22], opacity: [0.7, 0], strokeWidth: [2, 0.5] }}
      transition={{ duration: PULSE_DUR, delay, ease: 'easeOut' }}
    />
  );
}

// --- Root ---

export function TrafficAnimation() {
  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-muted/30">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full">
        <defs>
          <filter id="packet-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
            <feFlood floodColor="hsl(var(--primary))" floodOpacity="0.5" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Edges (behind nodes) */}
        <Edge d={EDGE_CLIENT_ROUTER} />
        <Edge d={EDGE_ROUTER_PRODUCTS} />
        <Edge d={EDGE_ROUTER_REVIEWS} />

        {/* Nodes */}
        <Node x={CLIENT.x} y={CLIENT.y} w={CLIENT.w} h={CLIENT.h} label="client" delay={0} clipId="n-client" />
        <Node
          x={ROUTER.x}
          y={ROUTER.y}
          w={ROUTER.w}
          h={ROUTER.h}
          label="Cosmo router"
          delay={0.15}
          clipId="n-router"
          showLogo
          large
        />
        <Node
          x={PRODUCTS.x}
          y={PRODUCTS.y}
          w={PRODUCTS.w}
          h={PRODUCTS.h}
          label="products"
          delay={0.3}
          clipId="n-products"
        />
        <Node x={REVIEWS.x} y={REVIEWS.y} w={REVIEWS.w} h={REVIEWS.h} label="reviews" delay={0.45} clipId="n-reviews" />

        {/* Request: client → router */}
        <Packet from={CLIENT_R} to={ROUTER_L} delay={T_REQ} duration={REQ_DUR} />

        {/* Fan-out: router → products + router → reviews */}
        <Packet from={ROUTER_R} to={PRODUCTS_L} delay={T_FANOUT} duration={FANOUT_DUR} />
        <Packet from={ROUTER_R} to={REVIEWS_L} delay={T_FANOUT} duration={FANOUT_DUR} />

        {/* Resolve pulses at subgraphs */}
        <ResolvePulse cx={PRODUCTS_L[0]} cy={PRODUCTS_L[1]} delay={T_RESOLVE} />
        <ResolvePulse cx={REVIEWS_L[0]} cy={REVIEWS_L[1]} delay={T_RESOLVE} />

        {/* Fan-in: products → router + reviews → router */}
        <Packet from={PRODUCTS_L} to={ROUTER_R} delay={T_FANIN} duration={FANOUT_DUR} />
        <Packet from={REVIEWS_L} to={ROUTER_R} delay={T_FANIN} duration={FANOUT_DUR} />

        {/* Merged: router → client */}
        <Packet from={ROUTER_L} to={CLIENT_R} delay={T_MERGED} duration={REQ_DUR} />
      </svg>
    </div>
  );
}
